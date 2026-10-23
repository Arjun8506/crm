import * as storage from '../../providers/storage.js';
import { ApiError } from '../../utils/errors.js';
import { csvCell } from '../records/csv.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { ValueError, parseValue } from '../dataforms/fieldTypes.js';
import { recordLimitError, recordRoom } from '../billing/entitlements.js';
import { notify } from '../notifications/notification.service.js';
import { RecordHistory, RecordModel } from '../records/record.model.js';
import { buildData, checkReferences, diff, loadFields } from '../records/record.service.js';
import { emitWorkspace } from '../../sockets/index.js';
import { Job } from '../queue/job.model.js';
import { registerHandler } from '../queue/queue.js';
import { runPreSave, triggerPostSave } from '../workflows/trigger.js';
import { convertCell } from './convert.js';
import { parseCsv } from './csvParse.js';
import { ImportJob } from './job.models.js';

export const MAX_IMPORT_ROWS = 20000;
export const MAX_IMPORT_MB = 10;
const MAX_ERRORS = 1000;
const LOCK_MS = 5 * 60_000;

// Fields an import may fill in: not computed, and allowed on create forms.
export const importable = (fields) => fields.filter((f) => !f.readOnly && f.visibility.create);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Human-readable text for a validation failure thrown by buildData / checkReferences / a workflow rule.
function describe(err, byKey) {
  if (err instanceof ApiError) {
    if (err.details?.length) {
      return err.details.map((d) => {
        const key = String(d.path).replace(/^data\./, '');
        return byKey.has(key) ? `${byKey.get(key).label}: ${d.message}` : d.message;
      }).join('; ');
    }
    return err.message;
  }
  return String(err.message ?? err).slice(0, 300);
}

class RowError extends Error {}

// Looks up related records by the target dataform's primary field (case-insensitive, exact).
function relationResolver(account) {
  const targets = new Map();
  const cache = new Map();
  return async (field, text) => {
    const tid = String(field.config.targetDataform);
    if (!targets.has(tid)) targets.set(tid, await Dataform.findOne({ _id: tid, account }).lean());
    const target = targets.get(tid);
    if (!target?.primaryField) throw new ValueError('The linked dataform has no name field to match on');
    const k = `${tid}:${text.toLowerCase()}`;
    if (!cache.has(k)) {
      const rows = await RecordModel.find({ account, dataform: target._id, [`data.${target.primaryField}`]: { $regex: `^${esc(text)}$`, $options: 'i' } }).select('_id').limit(2).lean();
      cache.set(k, rows.map((r) => String(r._id)));
    }
    const ids = cache.get(k);
    if (ids.length === 0) throw new ValueError(`No "${text}" found in ${target.name}`);
    if (ids.length > 1) throw new ValueError(`More than one "${text}" exists in ${target.name}`);
    return ids[0];
  };
}

async function errorsCsv(job, rows, errors) {
  const lines = [`${['Row', 'Error', ...job.headers].map(csvCell).join(',')}\r\n`];
  for (const e of errors) lines.push(`${[e.row, e.message, ...(rows[e.row - 2] ?? [])].map(csvCell).join(',')}\r\n`);
  const key = storage.newKey(job.account);
  await storage.put(key, Buffer.from(lines.join(''), 'utf8'));
  return key;
}

async function run({ importId }, { job: queueJob }) {
  const job = await ImportJob.findById(importId).select('+storageKey');
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const fields = await loadFields(job.dataform);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const dataform = await Dataform.findOne({ _id: job.dataform, account: job.account });
  if (!dataform) throw new Error('The dataform no longer exists');
  const auth = { userId: String(job.user), accountId: String(job.account), role: 'member' };

  const { rows: all } = parseCsv((await storage.read(job.storageKey)).toString('utf8'), { delimiter: job.delimiter, maxRows: MAX_IMPORT_ROWS });
  const rows = all.slice(1);
  job.status = 'running';
  job.startedAt ??= new Date();
  await job.save();

  const mapping = job.mapping.map((m) => ({ column: m.column, field: byKey.get(m.field) })).filter((m) => m.field);
  const { duplicate, matchField, dateFormat } = job.options;
  const resolve = relationResolver(job.account);
  const seenMatch = new Set();
  const seenUnique = new Map();
  const dry = job.dryRun;
  const capacity = await recordRoom(job.account);
  let room = capacity.room;
  const errors = [...job.errors];
  const counts = { ...job.counts.toObject() };

  const build = async (cells) => {
    const input = {};
    const problems = [];
    for (const { column, field } of mapping) {
      try {
        let v = convertCell(field, cells[column], { dateFormat });
        if (v !== undefined && field.type === 'relationship') v = await resolve(field, String(cells[column]).trim());
        if (v !== undefined) input[field.key] = v;
      } catch (e) {
        if (!(e instanceof ValueError)) throw e;
        problems.push(`${field.label}: ${e.message}`);
      }
    }
    if (problems.length) throw new RowError(problems.join('; '));
    return input;
  };

  const processRow = async (cells) => {
    const input = await build(cells);
    let existing = null;
    if (matchField && input[matchField] !== undefined) {
      const f = byKey.get(matchField);
      let value;
      try { value = parseValue(f, input[matchField]); } catch (e) {
        if (e instanceof ValueError) throw new RowError(`${f.label}: ${e.message}`);
        throw e;
      }
      const sig = `${matchField}:${JSON.stringify(value)}`;
      existing = await RecordModel.findOne({ account: job.account, dataform: job.dataform, [`data.${matchField}`]: value });
      if (!existing && dry && seenMatch.has(sig)) existing = { _id: null, data: {}, simulated: true };
      seenMatch.add(sig);
      if (existing) {
        if (duplicate === 'skip') return 'skipped';
        if (duplicate === 'error') throw new RowError(`${f.label} "${cells[mapping.find((m) => m.field.key === matchField).column]}" already exists`);
      }
    }

    if (existing) {
      const requested = buildData(fields, input, 'update');
      const before = existing.data;
      if (dry) return 'updated';
      const { data: next } = await runPreSave({ dataform, fields, event: 'update', before, after: { ...before, ...requested }, recordId: existing._id, auth });
      const patch = Object.fromEntries(diff(before, next).map((c) => [c.field, next[c.field]]));
      await checkReferences(auth, dataform, fields, patch, { excludeId: existing._id });
      const changes = diff(before, patch);
      if (changes.length) {
        existing.data = { ...before, ...patch };
        existing.markModified('data');
        existing.updatedBy = job.user;
        await existing.save();
        await RecordHistory.create({ account: job.account, dataform: job.dataform, record: existing._id, action: 'update', user: job.user, source: 'import', changes });
        await triggerPostSave({ dataform, fields, event: 'update', before, after: existing.data, recordId: existing._id, version: existing.updatedAt.getTime(), actorId: job.user });
      }
      return 'updated';
    }

    const built = buildData(fields, input, 'create');
    if (room <= 0) throw recordLimitError(capacity.limit);
    if (dry) {
      room--;
      // Without writing anything, still catch repeats of unique values within the file itself.
      for (const f of fields.filter((x) => x.unique && built[x.key] != null)) {
        const set = seenUnique.get(f.key) ?? new Set();
        const sig = JSON.stringify(built[f.key]);
        if (set.has(sig)) throw new RowError(`${f.label}: This value appears more than once in the file`);
        set.add(sig); seenUnique.set(f.key, set);
      }
      await checkReferences(auth, dataform, fields, built);
      return 'created';
    }
    const { data } = await runPreSave({ dataform, fields, event: 'create', before: null, after: built, auth });
    await checkReferences(auth, dataform, fields, data);
    const record = await RecordModel.create({ account: job.account, workspace: job.workspace, dataform: job.dataform, data, createdBy: job.user, updatedBy: job.user });
    room--;
    await RecordHistory.create({ account: job.account, dataform: job.dataform, record: record._id, action: 'create', user: job.user, source: 'import', changes: diff({}, data) });
    await triggerPostSave({ dataform, fields, event: 'create', before: null, after: record.data, recordId: record._id, version: record.createdAt.getTime(), actorId: job.user });
    return 'created';
  };

  // Resumes from the last checkpoint if a previous attempt was interrupted.
  for (let i = job.processed; i < rows.length; i++) {
    if (i % 20 === 0) {
      const fresh = await ImportJob.findById(job._id).select('status').lean();
      if (fresh?.status === 'cancelled') return;
      await Job.updateOne({ _id: queueJob._id }, { $set: { lockedUntil: new Date(Date.now() + LOCK_MS) } });
    }
    let outcome;
    try {
      outcome = await processRow(rows[i]);
    } catch (err) {
      if (!(err instanceof RowError) && !(err instanceof ApiError)) throw err;
      outcome = 'failed';
      if (errors.length < MAX_ERRORS) errors.push({ row: i + 2, message: describe(err, byKey) });
    }
    counts[outcome]++;
    await ImportJob.updateOne({ _id: job._id }, { $set: { processed: i + 1, counts, ...(outcome === 'failed' ? { errors } : {}) } });
  }

  const finished = await ImportJob.findById(job._id).select('status').lean();
  if (finished.status === 'cancelled') return;
  const update = { status: 'done', finishedAt: new Date() };
  if (errors.length) {
    // errors[].row is the row number in the file (header = 1), so the original cells are at index row - 2.
    const key = await errorsCsv(job, rows, errors);
    update.errorsKey = key;
    update.hasErrorsFile = true;
  }
  await ImportJob.updateOne({ _id: job._id }, { $set: update });
  if (!dry) emitWorkspace(job.workspace, 'record.changed', { dataformId: String(job.dataform), action: 'bulk' });
  const summary = `${counts.created} ${dry ? 'would be created' : 'created'}, ${counts.updated} ${dry ? 'would be updated' : 'updated'}, ${counts.skipped} skipped, ${counts.failed} failed`;
  await notify({
    account: job.account, recipients: [job.user], type: 'job_done', title: `${dry ? 'Import check' : 'Import'} finished: ${job.filename}`, body: summary,
    link: `/w/${job.workspace}/f/${job.dataform}`,
  });
}

async function onFinal({ importId }, err) {
  const job = await ImportJob.findById(importId).select('status user filename workspace dataform account').lean();
  if (!job || ['done', 'cancelled'].includes(job.status)) return;
  await ImportJob.updateOne({ _id: importId }, { $set: { status: 'failed', failure: String(err?.message ?? err).slice(0, 300), finishedAt: new Date() } });
  await notify({ account: job.account, recipients: [job.user], type: 'job_done', title: `Import failed: ${job.filename}`, body: String(err?.message ?? err).slice(0, 200), link: `/w/${job.workspace}/f/${job.dataform}` });
}

registerHandler('import.run', run, { onFinalFailure: onFinal });

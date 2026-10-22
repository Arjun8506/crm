import { PassThrough, Readable } from 'node:stream';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import * as storage from '../../providers/storage.js';
import { Attachment } from '../attachments/attachment.model.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { notify } from '../notifications/notification.service.js';
import { compileFilter, compileSearch, compileSort } from '../records/filter.js';
import { toCsv } from '../records/csv.js';
import { RecordModel } from '../records/record.model.js';
import { label, loadFields } from '../records/record.service.js';
import { registerHandler } from '../queue/queue.js';
import { ExportJob } from './job.models.js';

const MAX_FILES = 1000;
const MAX_BYTES = 1024 * 1024 * 1024;

// Lazy: the file is opened only when the archive gets to it, so a large export does not hold hundreds of files open.
const lazy = (key) => Readable.from((async function* read() { yield* storage.stream(key); }()));
const safe = (s) => {
  let out = '';
  for (const ch of String(s)) out += ch.codePointAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch;
  return out.replace(/^\.+/, '').slice(0, 80) || 'record';
};

async function run({ exportId }) {
  const job = await ExportJob.findById(exportId);
  if (!job || job.status !== 'queued') return;
  job.status = 'running';
  await job.save();
  const dataform = await Dataform.findOne({ _id: job.dataform, account: job.account });
  if (!dataform) throw new Error('The dataform no longer exists');
  const auth = { userId: String(job.user), accountId: String(job.account) };
  // Same rule as the on-screen list: only fields visible in lists are ever exported.
  const fields = (await loadFields(dataform._id)).filter((f) => f.visibility.list);
  const { q, sort, filter, columns } = job.params;
  const chosen = columns?.length ? columns.map((k) => fields.find((f) => f.key === k)).filter(Boolean) : fields;
  const parts = [{ account: dataform.account, dataform: dataform._id }];
  const search = compileSearch(q, fields);
  const flt = compileFilter(filter, fields);
  if (search) parts.push(search);
  if (flt) parts.push(flt);
  const query = { $and: parts };

  const key = storage.newKey(job.account);
  const csvName = `${dataform.slug}.csv`;
  const warnings = [];
  let rowCount;
  let fileCount = 0;

  if (job.format === 'csv') {
    const out = new PassThrough();
    const saved = storage.putStream(key, out);
    try {
      rowCount = await toCsv({ res: out, auth, dataform, fields: chosen, query, sort: compileSort(sort, fields) });
    } catch (err) { out.destroy(err); saved.catch(() => {}); throw err; }
    await saved;
  } else {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const saved = storage.putStream(key, archive);
    saved.catch(() => {});
    const csv = new PassThrough();
    archive.append(csv, { name: csvName });
    rowCount = await toCsv({ res: csv, auth, dataform, fields: chosen, query, sort: compileSort(sort, fields) });

    let bytes = 0;
    const used = new Set();
    let skipped = 0;
    for await (const r of RecordModel.find(query).sort(compileSort(sort, fields)).limit(50000).select('data').lean().cursor()) {
      const files = await Attachment.find({ account: job.account, record: r._id }).select('+storageKey').sort({ createdAt: 1 }).lean();
      for (const f of files) {
        if (fileCount >= MAX_FILES || bytes + f.size > MAX_BYTES) { skipped++; continue; }
        const dir = `attachments/${safe(label(dataform, r))} (${String(r._id).slice(-6)})`;
        let name = `${dir}/${safe(f.filename)}`;
        for (let n = 1; used.has(name); n++) name = `${dir}/${path.parse(safe(f.filename)).name} (${n})${path.extname(f.filename)}`;
        used.add(name);
        archive.append(lazy(f.storageKey), { name });
        bytes += f.size;
        fileCount++;
      }
    }
    if (skipped) warnings.push(`${skipped} file${skipped === 1 ? ' was' : 's were'} left out because the export reached its limit of ${MAX_FILES} files / 1 GB.`);
    await archive.finalize();
    await saved;
  }
  const size = await storage.size(key);
  await ExportJob.updateOne({ _id: job._id }, { $set: { status: 'done', storageKey: key, filename: job.format === 'zip' ? `${dataform.slug}-export.zip` : csvName, rowCount, fileCount, size, warnings, finishedAt: new Date() } });
  await notify({ account: job.account, recipients: [job.user], type: 'job_done', title: `Your export of ${dataform.name} is ready`, body: `${rowCount} record${rowCount === 1 ? '' : 's'}`, link: `/w/${job.workspace}/f/${job.dataform}` });
}

async function onFinal({ exportId }, err) {
  const job = await ExportJob.findById(exportId).lean();
  if (!job || job.status === 'done') return;
  await ExportJob.updateOne({ _id: exportId }, { $set: { status: 'failed', failure: String(err?.message ?? err).slice(0, 300), finishedAt: new Date() } });
  await notify({ account: job.account, recipients: [job.user], type: 'job_done', title: 'An export failed', body: String(err?.message ?? err).slice(0, 200), link: `/w/${job.workspace}/f/${job.dataform}` });
}

// A failed attempt may leave the job "running"; put it back so the retry can pick it up.
registerHandler('export.run', async (payload, ctx) => {
  await ExportJob.updateOne({ _id: payload.exportId, status: 'running' }, { $set: { status: 'queued' } });
  return run(payload, ctx);
}, { onFinalFailure: onFinal });

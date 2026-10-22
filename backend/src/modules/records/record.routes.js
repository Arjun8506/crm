import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { ValueError, parseValue } from '../dataforms/fieldTypes.js';
import { toCsv } from './csv.js';
import { emitWorkspace } from '../../sockets/index.js';
import { autoFollow, followersOf } from '../comments/comment.service.js';
import { notify } from '../notifications/notification.service.js';
import { User } from '../users/user.model.js';
import { ApiKey } from '../apikeys/apikey.model.js';
import { purgeRecords } from './cleanup.js';
import { runPreSave, triggerPostSave } from '../workflows/trigger.js';
import { FieldDefinition } from '../dataforms/dataform.model.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { RecordHistory, RecordModel } from './record.model.js';
import { compileFilter, compileSearch, compileSort, filterSchema } from './filter.js';
import { buildData, checkReferences, diff, label, loadFields, projectForList, resolveRefs, writeHistory } from './record.service.js';

// Mounted at /dataforms/:id/records. loadDataform() enforces tenant + workspace access.
const router = Router({ mergeParams: true });
router.use(authenticate);

const idParams = z.object({ id: objectId });
const recordParams = z.object({ id: objectId, recordId: objectId });
const dataBody = z.object({ data: z.record(z.string(), z.unknown()) });
const MAX_BULK = 200;

// Live updates carry ids only; clients refetch through the authorized API.
const changed = (dataform, recordId, action) => emitWorkspace(dataform.workspace, 'record.changed', { dataformId: String(dataform._id), recordId: recordId ? String(recordId) : undefined, action });

const writable = async (req) => {
  const ctx = await loadDataform(req, 'editor');
  if (ctx.dataform.status === 'archived') throw conflict('This dataform is archived and read-only');
  return ctx;
};

const findRecord = async (req, dataform) => {
  const record = await RecordModel.findOne({ _id: req.params.recordId, account: req.auth.accountId, dataform: dataform._id });
  if (!record) throw notFound('Record not found');
  return record;
};

const queryBody = z.object({
  page: z.number().int().min(1).max(100000).default(1),
  limit: z.number().int().min(1).max(200).default(25),
  sort: z.string().max(60).optional(),
  q: z.string().max(100).optional(),
  filter: filterSchema.optional(),
  fields: z.array(z.string().max(60)).max(100).optional(),
});

// Validates a `fields` selection (a list of field keys) against the dataform and trims each record's data to it.
function selection(fields, keys) {
  if (!keys?.length) return null;
  const known = new Set(fields.map((f) => f.key));
  const bad = keys.find((k) => !known.has(k));
  if (bad) throw badRequest(`Unknown field: ${bad}`);
  return new Set(keys);
}
const trim = (rows, keys) => (keys ? rows.map((r) => ({ ...r, data: Object.fromEntries(Object.entries(r.data ?? {}).filter(([k]) => keys.has(k))) })) : rows);

async function runQuery(req, input) {
  const { dataform } = await loadDataform(req);
  const fields = await loadFields(dataform._id);
  const keys = selection(fields, input.fields);
  const { page, limit } = input;
  const parts = [{ account: dataform.account, dataform: dataform._id }];
  const search = compileSearch(input.q, fields);
  const filter = compileFilter(input.filter, fields);
  if (search) parts.push(search);
  if (filter) parts.push(filter);
  const query = { $and: parts };
  const [rows, total] = await Promise.all([
    RecordModel.find(query).sort(compileSort(input.sort, fields)).skip((page - 1) * limit).limit(limit).lean(),
    RecordModel.countDocuments(query),
  ]);
  return { data: trim(projectForList(fields, rows), keys).map((r) => ({ ...r, _label: label(dataform, r) })), refs: await resolveRefs(req.auth, dataform, fields, rows), page, limit, total };
}

router.post('/query', validate({ params: idParams, body: queryBody }), async (req, res) => res.json(await runQuery(req, req.body)));

// Plain REST list for API consumers: filters travel in the query string (filter is the same JSON tree, URL-encoded).
router.get(
  '/',
  validate({
    params: idParams,
    query: z.object({
      page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(200).default(25),
      sort: z.string().max(60).optional(), q: z.string().max(100).optional(), filter: z.string().max(8000).optional(), fields: z.string().max(1000).optional(),
    }),
  }),
  async (req, res) => {
    let filter;
    if (req.query.filter) {
      let parsed;
      try { parsed = JSON.parse(req.query.filter); } catch { throw badRequest('filter must be valid JSON'); }
      const result = filterSchema.safeParse(parsed);
      if (!result.success) throw badRequest('Invalid filter', result.error.issues.map((i) => ({ path: `filter.${i.path.join('.')}`, message: i.message })));
      filter = result.data;
    }
    const { page, limit, sort, q } = req.query;
    res.json(await runQuery(req, { page, limit, sort, q, filter, fields: req.query.fields?.split(',').map((k) => k.trim()).filter(Boolean) }));
  },
);

router.post('/', validate({ params: idParams, body: dataBody }), async (req, res) => {
  const { dataform, access } = await writable(req);
  const fields = await loadFields(dataform._id);
  const built = buildData(fields, req.body.data, 'create');
  const { data } = await runPreSave({ dataform, fields, event: 'create', before: null, after: built, auth: req.auth });
  await checkReferences(req.auth, dataform, fields, data);
  const record = await RecordModel.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, data, createdBy: req.auth.userId, updatedBy: req.auth.userId,
  });
  await writeHistory([{ account: dataform.account, dataform: dataform._id, record: record._id, action: 'create', user: req.auth.userId, changes: diff({}, data) }]);
  if (!req.auth.apiKey) await autoFollow({ workspace: access.workspace, dataform: dataform._id, record: record._id, userIds: [req.auth.userId] });
  changed(dataform, record._id, 'create');
  await triggerPostSave({ dataform, fields, event: 'create', before: null, after: record.data, recordId: record._id, version: record.createdAt.getTime(), actorId: req.auth.userId });
  res.status(201).json({ record, refs: await resolveRefs(req.auth, dataform, fields, [record]) });
});

// Streams matching records as CSV. Honours list visibility and escapes formula-injection prefixes.
router.post(
  '/export',
  validate({
    params: idParams,
    body: z.object({
      q: z.string().max(100).optional(), sort: z.string().max(60).optional(), filter: filterSchema.optional(),
      columns: z.array(z.string().max(60)).max(100).optional(),
    }),
  }),
  async (req, res) => {
    const { dataform } = await loadDataform(req);
    const fields = (await loadFields(dataform._id)).filter((f) => f.visibility.list);
    const chosen = req.body.columns ? req.body.columns.map((k) => fields.find((f) => f.key === k)).filter(Boolean) : fields;
    const parts = [{ account: dataform.account, dataform: dataform._id }];
    const search = compileSearch(req.body.q, fields);
    const filter = compileFilter(req.body.filter, fields);
    if (search) parts.push(search);
    if (filter) parts.push(filter);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${dataform.slug}.csv"`);
    await toCsv({ res, auth: req.auth, dataform, fields: chosen, query: { $and: parts }, sort: compileSort(req.body.sort, fields) });
  },
);

router.post(
  '/:recordId/move',
  validate({
    params: recordParams,
    body: z.object({ field: z.string().max(60), value: z.string().max(80), beforeId: objectId.optional(), afterId: objectId.optional() }),
  }),
  async (req, res) => {
    const { dataform } = await writable(req);
    const record = await findRecord(req, dataform);
    const fields = await loadFields(dataform._id);
    const stage = fields.find((f) => f.key === req.body.field);
    if (!stage || stage.type !== 'dropdown' || stage.readOnly || !stage.visibility.edit) throw badRequest('Cards can only be moved between the stages of an editable dropdown field');
    let value;
    try { value = parseValue(stage, req.body.value); } catch (e) { if (e instanceof ValueError) throw badRequest(e.message); throw e; }

    const rankOf = async (id) => (id ? (await RecordModel.findOne({ _id: id, account: dataform.account, dataform: dataform._id }).select('rank').lean())?.rank : undefined);
    const [next, prev] = await Promise.all([rankOf(req.body.beforeId), rankOf(req.body.afterId)]);
    record.rank = next !== undefined && prev !== undefined ? (prev + next) / 2 : next !== undefined ? next - 1000 : prev !== undefined ? prev + 1000 : Date.now();

    const before = record.data;
    const { data: moved } = await runPreSave({ dataform, fields, event: 'update', before, after: { ...before, [stage.key]: value }, recordId: record._id, auth: req.auth });
    const changes = diff(before, moved);
    record.data = moved;
    record.markModified('data');
    record.updatedBy = req.auth.userId;
    await record.save();
    await writeHistory(changes.length ? [{ account: dataform.account, dataform: dataform._id, record: record._id, action: 'update', user: req.auth.userId, changes }] : []);
    changed(dataform, record._id, 'update');
    if (changes.length) await triggerPostSave({ dataform, fields, event: 'update', before, after: record.data, recordId: record._id, version: record.updatedAt.getTime(), actorId: req.auth.userId });
    res.json({ record });
  },
);

router.post('/bulk', validate({
  params: idParams,
  body: z.discriminatedUnion('action', [
    z.object({ action: z.literal('delete'), ids: z.array(objectId).min(1).max(MAX_BULK) }),
    z.object({ action: z.literal('update'), ids: z.array(objectId).min(1).max(MAX_BULK), data: z.record(z.string(), z.unknown()) }),
  ]),
}), async (req, res) => {
  const { dataform } = await writable(req);
  const ids = [...new Set(req.body.ids)];
  const records = await RecordModel.find({ _id: { $in: ids }, account: dataform.account, dataform: dataform._id }).lean();
  const fields = await loadFields(dataform._id);

  if (req.body.action === 'delete') {
    // Every record is checked first, so one blocked delete stops the whole batch before anything is removed.
    for (const r of records) await runPreSave({ dataform, fields, event: 'delete', before: r.data, after: null, recordId: r._id, auth: req.auth });
    const found = records.map((r) => r._id);
    await RecordModel.deleteMany({ _id: { $in: found }, account: dataform.account });
    await clearReferences(dataform, found);
    await purgeRecords(dataform.account, found);
    changed(dataform, undefined, 'bulk');
    await writeHistory(found.map((record) => ({ account: dataform.account, dataform: dataform._id, record, action: 'delete', user: req.auth.userId })));
    for (const r of records) await triggerPostSave({ dataform, fields, event: 'delete', before: r.data, after: null, recordId: r._id, version: Date.now(), actorId: req.auth.userId });
    return res.json({ affected: found.length });
  }

  const patch = buildData(fields, req.body.data, 'update');
  if (Object.keys(patch).length === 0) return res.json({ affected: 0 });
  const uniqueKey = fields.find((f) => f.unique && f.key in patch && patch[f.key] !== null);
  if (uniqueKey && records.length > 1) throw conflict(`"${uniqueKey.label}" must be unique, so it cannot be set on several records at once`);
  await checkReferences(req.auth, dataform, fields, patch, { excludeId: records[0]?._id });

  // Each record goes through "before save" workflows on its own, so a rule cannot be bypassed with a bulk edit.
  const ops = []; const histories = []; const saved = [];
  for (const r of records) {
    const { data: next } = await runPreSave({ dataform, fields, event: 'update', before: r.data, after: { ...r.data, ...patch }, recordId: r._id, auth: req.auth });
    const changes = diff(r.data, next);
    if (!changes.length) continue;
    ops.push({ updateOne: { filter: { _id: r._id, account: dataform.account }, update: { $set: { updatedBy: req.auth.userId, ...Object.fromEntries(changes.map((c) => [`data.${c.field}`, next[c.field]])) } } } });
    histories.push({ account: dataform.account, dataform: dataform._id, record: r._id, action: 'update', user: req.auth.userId, changes });
    saved.push({ r, next });
  }
  if (ops.length) await RecordModel.bulkWrite(ops);
  await writeHistory(histories);
  changed(dataform, undefined, 'bulk');
  for (const { r, next } of saved) await triggerPostSave({ dataform, fields, event: 'update', before: r.data, after: next, recordId: r._id, version: Date.now(), actorId: req.auth.userId });
  res.json({ affected: records.length });
});

router.get('/:recordId', validate({ params: recordParams, query: z.object({ fields: z.string().max(1000).optional() }) }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  const record = await findRecord(req, dataform);
  const fields = await loadFields(dataform._id);
  const keys = selection(fields, req.query.fields?.split(',').map((k) => k.trim()).filter(Boolean));
  res.json({ record: trim([record.toObject()], keys)[0], refs: await resolveRefs(req.auth, dataform, fields, [record.toObject()]) });
});

router.patch('/:recordId', validate({ params: recordParams, body: dataBody }), async (req, res) => {
  const { dataform } = await writable(req);
  const record = await findRecord(req, dataform);
  const fields = await loadFields(dataform._id);
  const requested = buildData(fields, req.body.data, 'update');
  const before = record.data;
  const { data: next } = await runPreSave({ dataform, fields, event: 'update', before, after: { ...before, ...requested }, recordId: record._id, auth: req.auth });
  const patch = Object.fromEntries(diff(before, next).map((c) => [c.field, next[c.field]]));
  await checkReferences(req.auth, dataform, fields, patch, { excludeId: record._id });

  const changes = diff(record.data, patch);
  if (changes.length) {
    record.data = { ...record.data, ...patch };
    record.markModified('data');
    record.updatedBy = req.auth.userId;
    await record.save();
    await writeHistory([{ account: dataform.account, dataform: dataform._id, record: record._id, action: 'update', user: req.auth.userId, changes }]);
    const [actor, followers] = await Promise.all([User.findById(req.auth.userId).select('name').lean(), followersOf(record._id)]);
    const names = changes.map((c) => fields.find((f) => f.key === c.field)?.label ?? c.field).join(', ');
    await notify({
      account: dataform.account, recipients: followers, actor: req.auth.userId, type: 'record_update',
      title: `${actor?.name ?? 'Someone'} updated ${label(dataform, record.toObject())}`, body: `Changed: ${names}`,
      link: `/w/${dataform.workspace}/f/${dataform._id}?record=${record._id}`,
    });
    changed(dataform, record._id, 'update');
    await triggerPostSave({ dataform, fields, event: 'update', before, after: record.data, recordId: record._id, version: record.updatedAt.getTime(), actorId: req.auth.userId });
  }
  res.json({ record, refs: await resolveRefs(req.auth, dataform, fields, [record.toObject()]) });
});

router.post('/:recordId/copy', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await writable(req);
  const source = await findRecord(req, dataform);
  const fields = await loadFields(dataform._id);
  // Unique and read-only fields are not carried over to the copy.
  const copied = Object.fromEntries(Object.entries(source.data).filter(([k]) => {
    const f = fields.find((x) => x.key === k);
    return f && !f.unique && !f.readOnly;
  }));
  const { data } = await runPreSave({ dataform, fields, event: 'create', before: null, after: copied, auth: req.auth });
  const copy = await RecordModel.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, data, createdBy: req.auth.userId, updatedBy: req.auth.userId,
  });
  await writeHistory([{ account: dataform.account, dataform: dataform._id, record: copy._id, action: 'create', user: req.auth.userId, changes: diff({}, data) }]);
  changed(dataform, copy._id, 'create');
  await triggerPostSave({ dataform, fields, event: 'create', before: null, after: copy.data, recordId: copy._id, version: copy.createdAt.getTime(), actorId: req.auth.userId });
  res.status(201).json({ record: copy });
});

router.delete('/:recordId', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await writable(req);
  const record = await findRecord(req, dataform);
  const fields = await loadFields(dataform._id);
  await runPreSave({ dataform, fields, event: 'delete', before: record.data, after: null, recordId: record._id, auth: req.auth });
  await record.deleteOne();
  await clearReferences(dataform, [record._id]);
  await purgeRecords(dataform.account, [record._id]);
  changed(dataform, record._id, 'delete');
  await writeHistory([{ account: dataform.account, dataform: dataform._id, record: record._id, action: 'delete', user: req.auth.userId }]);
  await triggerPostSave({ dataform, fields, event: 'delete', before: record.data, after: null, recordId: record._id, version: Date.now(), actorId: req.auth.userId });
  res.status(204).end();
});

router.get('/:recordId/history', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  const history = await RecordHistory.find({ account: dataform.account, dataform: dataform._id, record: req.params.recordId }).sort({ at: -1 }).limit(100).lean();
  // The actor is a person or an API key: resolve either to a display name.
  const ids = [...new Set(history.map((h) => h.user).filter(Boolean).map(String))];
  const [users, keys] = await Promise.all([User.find({ _id: { $in: ids } }).select('name').lean(), ApiKey.find({ _id: { $in: ids } }).select('name').lean()]);
  const names = new Map([...users.map((u) => [String(u._id), { name: u.name }]), ...keys.map((k) => [String(k._id), { name: `API key: ${k.name}` }])]);
  res.json({ data: history.map((h) => ({ ...h, user: names.get(String(h.user)) ?? null })) });
});

// Removes dangling relationship values after records are deleted.
async function clearReferences(dataform, deletedIds) {
  const relFields = await FieldDefinition.find({ account: dataform.account, 'config.targetDataform': dataform._id }).lean();
  await Promise.all(relFields.map((f) => RecordModel.updateMany(
    { account: dataform.account, dataform: f.dataform, [`data.${f.key}`]: { $in: deletedIds } },
    { $unset: { [`data.${f.key}`]: '' } },
  )));
}

export default router;

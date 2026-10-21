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
import { purgeRecords } from './cleanup.js';
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

router.post(
  '/query',
  validate({
    params: idParams,
    body: z.object({
      page: z.number().int().min(1).max(100000).default(1),
      limit: z.number().int().min(1).max(200).default(25),
      sort: z.string().max(60).optional(),
      q: z.string().max(100).optional(),
      filter: filterSchema.optional(),
    }),
  }),
  async (req, res) => {
    const { dataform } = await loadDataform(req);
    const fields = await loadFields(dataform._id);
    const { page, limit } = req.body;
    const parts = [{ account: dataform.account, dataform: dataform._id }];
    const search = compileSearch(req.body.q, fields);
    const filter = compileFilter(req.body.filter, fields);
    if (search) parts.push(search);
    if (filter) parts.push(filter);
    const query = { $and: parts };

    const [rows, total] = await Promise.all([
      RecordModel.find(query).sort(compileSort(req.body.sort, fields)).skip((page - 1) * limit).limit(limit).lean(),
      RecordModel.countDocuments(query),
    ]);
    res.json({
      data: projectForList(fields, rows).map((r) => ({ ...r, _label: label(dataform, r) })), refs: await resolveRefs(req.auth, dataform, fields, rows), page, limit, total,
    });
  },
);

router.post('/', validate({ params: idParams, body: dataBody }), async (req, res) => {
  const { dataform, access } = await writable(req);
  const fields = await loadFields(dataform._id);
  const data = buildData(fields, req.body.data, 'create');
  await checkReferences(req.auth, dataform, fields, data);
  const record = await RecordModel.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, data, createdBy: req.auth.userId, updatedBy: req.auth.userId,
  });
  await writeHistory([{ account: dataform.account, dataform: dataform._id, record: record._id, action: 'create', user: req.auth.userId, changes: diff({}, data) }]);
  await autoFollow({ workspace: access.workspace, dataform: dataform._id, record: record._id, userIds: [req.auth.userId] });
  changed(dataform, record._id, 'create');
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

    const changes = diff(record.data, { [stage.key]: value });
    record.data = { ...record.data, [stage.key]: value };
    record.markModified('data');
    record.updatedBy = req.auth.userId;
    await record.save();
    await writeHistory(changes.length ? [{ account: dataform.account, dataform: dataform._id, record: record._id, action: 'update', user: req.auth.userId, changes }] : []);
    changed(dataform, record._id, 'update');
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
    const found = records.map((r) => r._id);
    await RecordModel.deleteMany({ _id: { $in: found }, account: dataform.account });
    await clearReferences(dataform, found);
    await purgeRecords(dataform.account, found);
    changed(dataform, undefined, 'bulk');
    await writeHistory(found.map((record) => ({ account: dataform.account, dataform: dataform._id, record, action: 'delete', user: req.auth.userId })));
    return res.json({ affected: found.length });
  }

  const patch = buildData(fields, req.body.data, 'update');
  if (Object.keys(patch).length === 0) return res.json({ affected: 0 });
  const uniqueKey = fields.find((f) => f.unique && f.key in patch && patch[f.key] !== null);
  if (uniqueKey && records.length > 1) throw conflict(`"${uniqueKey.label}" must be unique, so it cannot be set on several records at once`);
  await checkReferences(req.auth, dataform, fields, patch, { excludeId: records[0]?._id });

  await writeHistory(records.map((r) => ({
    account: dataform.account, dataform: dataform._id, record: r._id, action: 'update', user: req.auth.userId, changes: diff(r.data, patch),
  })).filter((h) => h.changes.length));
  const $set = { updatedBy: req.auth.userId, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`data.${k}`, v])) };
  await RecordModel.updateMany({ _id: { $in: records.map((r) => r._id) }, account: dataform.account }, { $set });
  changed(dataform, undefined, 'bulk');
  res.json({ affected: records.length });
});

router.get('/:recordId', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  const record = await findRecord(req, dataform);
  const fields = await loadFields(dataform._id);
  res.json({ record, refs: await resolveRefs(req.auth, dataform, fields, [record.toObject()]) });
});

router.patch('/:recordId', validate({ params: recordParams, body: dataBody }), async (req, res) => {
  const { dataform } = await writable(req);
  const record = await findRecord(req, dataform);
  const fields = await loadFields(dataform._id);
  const patch = buildData(fields, req.body.data, 'update');
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
  }
  res.json({ record, refs: await resolveRefs(req.auth, dataform, fields, [record.toObject()]) });
});

router.post('/:recordId/copy', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await writable(req);
  const source = await findRecord(req, dataform);
  const fields = await loadFields(dataform._id);
  // Unique and read-only fields are not carried over to the copy.
  const data = Object.fromEntries(Object.entries(source.data).filter(([k]) => {
    const f = fields.find((x) => x.key === k);
    return f && !f.unique && !f.readOnly;
  }));
  const copy = await RecordModel.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, data, createdBy: req.auth.userId, updatedBy: req.auth.userId,
  });
  await writeHistory([{ account: dataform.account, dataform: dataform._id, record: copy._id, action: 'create', user: req.auth.userId, changes: diff({}, data) }]);
  changed(dataform, copy._id, 'create');
  res.status(201).json({ record: copy });
});

router.delete('/:recordId', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await writable(req);
  const record = await findRecord(req, dataform);
  await record.deleteOne();
  await clearReferences(dataform, [record._id]);
  await purgeRecords(dataform.account, [record._id]);
  changed(dataform, record._id, 'delete');
  await writeHistory([{ account: dataform.account, dataform: dataform._id, record: record._id, action: 'delete', user: req.auth.userId }]);
  res.status(204).end();
});

router.get('/:recordId/history', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  const history = await RecordHistory.find({ account: dataform.account, dataform: dataform._id, record: req.params.recordId })
    .sort({ at: -1 }).limit(100).populate('user', 'name').lean();
  res.json({ data: history });
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

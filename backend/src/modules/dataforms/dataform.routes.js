import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { workspaceAccess } from '../workspaces/access.js';
import { RecordHistory, RecordModel } from '../records/record.model.js';
import { Dataform, FieldDefinition } from './dataform.model.js';
import { purgeDataformArtifacts } from '../records/cleanup.js';
import { TYPE_NAMES, operatorsFor } from './fieldTypes.js';
import { TEMPLATES } from './templates.js';
import { addField, assertUniqueSafe, createDataform, loadDataform, normalizeField, uniqueDataformSlug } from './dataform.service.js';

const router = Router();
router.use(authenticate);

const fieldBody = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, numbers and underscores, starting with a letter'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(TYPE_NAMES),
  description: z.string().trim().max(300).optional(),
  section: z.string().trim().min(1).max(60).optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  options: z.array(z.object({ value: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(80) })).max(100).optional(),
  config: z.object({ targetDataform: objectId.nullable().optional() }).optional(),
  visibility: z.object({ create: z.boolean().optional(), edit: z.boolean().optional(), list: z.boolean().optional() }).optional(),
});
const fieldUpdateBody = fieldBody.omit({ key: true, type: true }).partial();

const formBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(60).optional(),
});

const idParams = z.object({ id: objectId });
const fieldParams = z.object({ id: objectId, fieldId: objectId });

router.get('/types', (_req, res) => {
  res.json({ types: TYPE_NAMES.map((t) => ({ type: t, operators: operatorsFor(t) })), templates: TEMPLATES.map(({ id, name, description, category, fields }) => ({ id, name, description, category, fieldCount: fields.length })) });
});

router.get('/', validate({ query: z.object({ workspaceId: objectId, includeArchived: z.enum(['true', 'false']).optional() }) }), async (req, res) => {
  const { workspace } = await workspaceAccess(req.auth, req.query.workspaceId);
  const dataforms = await Dataform.find({
    account: req.auth.accountId, workspace: workspace._id, ...(req.query.includeArchived === 'true' ? {} : { status: 'active' }),
  }).sort({ category: 1, name: 1 }).lean();
  const ids = dataforms.map((d) => d._id);
  const [counts, fieldCounts] = await Promise.all([
    RecordModel.aggregate([{ $match: { account: workspace.account, dataform: { $in: ids } } }, { $group: { _id: '$dataform', n: { $sum: 1 } } }]),
    FieldDefinition.aggregate([{ $match: { dataform: { $in: ids } } }, { $group: { _id: '$dataform', n: { $sum: 1 } } }]),
  ]);
  const rc = new Map(counts.map((c) => [String(c._id), c.n]));
  const fc = new Map(fieldCounts.map((c) => [String(c._id), c.n]));
  res.json({ data: dataforms.map((d) => ({ ...d, recordCount: rc.get(String(d._id)) || 0, fieldCount: fc.get(String(d._id)) || 0 })) });
});

router.post(
  '/',
  validate({ body: formBody.extend({ workspaceId: objectId, templateId: z.string().max(40).optional() }) }),
  async (req, res) => {
    const { workspace } = await workspaceAccess(req.auth, req.body.workspaceId, 'admin');
    const template = req.body.templateId ? TEMPLATES.find((t) => t.id === req.body.templateId) : null;
    if (req.body.templateId && !template) throw badRequest('Unknown template');

    const dataform = await createDataform({
      accountId: req.auth.accountId, userId: req.auth.userId, workspace, name: req.body.name, description: req.body.description, category: req.body.category, template,
    });
    res.status(201).json({ dataform });
  },
);

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const { dataform, access } = await loadDataform(req);
  const fields = await FieldDefinition.find({ dataform: dataform._id }).sort({ order: 1, createdAt: 1 }).lean();
  res.json({ dataform, fields, access: access.levelName });
});

router.patch(
  '/:id',
  validate({
    params: idParams,
    body: formBody.partial().extend({ status: z.enum(['active', 'archived']).optional(), primaryField: z.string().max(40).optional() }),
  }),
  async (req, res) => {
    const { dataform } = await loadDataform(req, 'admin');
    if (req.body.primaryField && !(await FieldDefinition.exists({ dataform: dataform._id, key: req.body.primaryField }))) {
      throw badRequest('primaryField must be one of this dataform\'s fields');
    }
    Object.assign(dataform, req.body);
    await dataform.save();
    res.json({ dataform });
  },
);

router.post('/:id/clone', validate({ params: idParams }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  const name = `${dataform.name} (copy)`;
  const copy = await Dataform.create({
    account: dataform.account, workspace: dataform.workspace, name, description: dataform.description, category: dataform.category,
    primaryField: dataform.primaryField, slug: await uniqueDataformSlug(dataform.account, dataform.workspace, name), createdBy: req.auth.userId,
  });
  const fields = await FieldDefinition.find({ dataform: dataform._id }).lean();
  // Self-referencing relationships point at the copy, not the original.
  await FieldDefinition.insertMany(fields.map(({ _id: _omitId, createdAt: _c, updatedAt: _u, ...f }) => ({
    ...f, dataform: copy._id,
    config: { targetDataform: String(f.config?.targetDataform) === String(dataform._id) ? copy._id : f.config?.targetDataform ?? null },
  })));
  res.status(201).json({ dataform: copy });
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  const referrer = await FieldDefinition.findOne({ account: dataform.account, 'config.targetDataform': dataform._id, dataform: { $ne: dataform._id } }).lean();
  if (referrer) throw conflict('Another dataform has a relationship field pointing here. Remove that field first.');
  await purgeDataformArtifacts(dataform.account, dataform._id);
  await Promise.all([
    RecordModel.deleteMany({ account: dataform.account, dataform: dataform._id }),
    RecordHistory.deleteMany({ account: dataform.account, dataform: dataform._id }),
    FieldDefinition.deleteMany({ dataform: dataform._id }),
  ]);
  await dataform.deleteOne();
  res.status(204).end();
});

// ---- fields ----

router.post('/:id/fields', validate({ params: idParams, body: fieldBody }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  const field = await addField(dataform, req.body);
  if (field.unique) await assertUniqueSafe(dataform, field.key).catch(async (e) => { await field.deleteOne(); throw e; });
  res.status(201).json({ field });
});

// Registered before /:fieldId so "order" is not read as an id.
router.put('/:id/fields/order', validate({ params: idParams, body: z.object({ ids: z.array(objectId).max(100) }) }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  const existing = await FieldDefinition.find({ dataform: dataform._id }).select('_id').lean();
  const have = new Set(existing.map((f) => String(f._id)));
  if (req.body.ids.length !== have.size || !req.body.ids.every((i) => have.has(i))) throw badRequest('ids must list every field exactly once');
  await FieldDefinition.bulkWrite(req.body.ids.map((id, order) => ({ updateOne: { filter: { _id: id, dataform: dataform._id }, update: { $set: { order } } } })));
  res.json({ ok: true });
});

router.patch('/:id/fields/:fieldId', validate({ params: fieldParams, body: fieldUpdateBody }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  const field = await FieldDefinition.findOne({ _id: req.params.fieldId, dataform: dataform._id });
  if (!field) throw notFound('Field not found');
  const f = await normalizeField(dataform, req.body, { existing: field });
  if (f.unique && !field.unique) await assertUniqueSafe(dataform, field.key);
  for (const k of ['label', 'description', 'section', 'required', 'unique', 'readOnly', 'defaultValue', 'min', 'max', 'options', 'config', 'visibility']) field[k] = f[k];
  await field.save();
  res.json({ field });
});

router.delete('/:id/fields/:fieldId', validate({ params: fieldParams }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  const field = await FieldDefinition.findOne({ _id: req.params.fieldId, dataform: dataform._id });
  if (!field) throw notFound('Field not found');
  await RecordModel.updateMany({ account: dataform.account, dataform: dataform._id }, { $unset: { [`data.${field.key}`]: '' } });
  await field.deleteOne();
  if (dataform.primaryField === field.key) {
    const next = await FieldDefinition.findOne({ dataform: dataform._id, type: { $in: ['text', 'email'] } }).sort({ order: 1 }).lean();
    dataform.primaryField = next?.key ?? null;
    await dataform.save();
  }
  res.status(204).end();
});

export default router;

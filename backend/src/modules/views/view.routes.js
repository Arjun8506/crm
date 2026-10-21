import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { filterSchema, compileFilter } from '../records/filter.js';
import { loadFields } from '../records/record.service.js';
import { LEVEL } from '../workspaces/access.js';
import { View } from './view.model.js';

// Mounted at /dataforms/:id/views
const router = Router({ mergeParams: true });
router.use(authenticate);

const key = z.string().max(60);
const config = z.object({
  q: z.string().max(100).optional(),
  filter: filterSchema.nullish(),
  sort: z.string().max(60).optional(),
  hiddenColumns: z.array(key).max(100).optional(),
  groupField: key.optional(), // kanban stage field
  dateField: key.optional(), // calendar
  locationField: key.optional(), // map
  cardFields: z.array(key).max(6).optional(),
  pageSize: z.number().int().min(5).max(200).optional(),
});
const body = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['table', 'cards', 'kanban', 'calendar', 'map']),
  shared: z.boolean().default(false),
  config,
});
const idParams = z.object({ id: objectId });
const viewParams = z.object({ id: objectId, viewId: objectId });

router.get('/', validate({ params: idParams }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  const views = await View.find({
    account: dataform.account, dataform: dataform._id, $or: [{ shared: true }, { owner: req.auth.userId }],
  }).sort({ name: 1 }).populate('owner', 'name').lean();
  res.json({ data: views.map((v) => ({ ...v, mine: String(v.owner._id) === req.auth.userId })) });
});

async function checked(req, { creating = false } = {}) {
  const ctx = await loadDataform(req);
  const fields = await loadFields(ctx.dataform._id);
  compileFilter(req.body.config.filter, fields); // reject filters that reference unknown fields/operators
  if (req.body.shared && ctx.access.level < LEVEL.editor) throw forbidden('Only editors can share views');
  return { ...ctx, creating };
}

router.post('/', validate({ params: idParams, body }), async (req, res) => {
  const { dataform } = await checked(req, { creating: true });
  const view = await View.create({ ...req.body, account: dataform.account, dataform: dataform._id, owner: req.auth.userId });
  res.status(201).json({ view });
});

async function ownView(req, dataform, access) {
  const view = await View.findOne({ _id: req.params.viewId, account: dataform.account, dataform: dataform._id });
  if (!view || (!view.shared && String(view.owner) !== req.auth.userId)) throw notFound('View not found');
  // Shared views belong to their creator, but workspace admins may curate them.
  if (String(view.owner) !== req.auth.userId && access.level < LEVEL.admin) throw forbidden('Only the owner can change this view');
  return view;
}

router.patch('/:viewId', validate({ params: viewParams, body }), async (req, res) => {
  const { dataform, access } = await checked(req);
  const view = await ownView(req, dataform, access);
  Object.assign(view, req.body);
  view.markModified('config');
  await view.save();
  res.json({ view });
});

router.delete('/:viewId', validate({ params: viewParams }), async (req, res) => {
  const { dataform, access } = await loadDataform(req);
  const view = await ownView(req, dataform, access);
  await view.deleteOne();
  res.status(204).end();
});

export default router;

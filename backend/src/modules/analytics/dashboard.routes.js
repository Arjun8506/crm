import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { can } from '../../config/permissions.js';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { compileFilter, compileSearch, compileSort, filterSchema } from '../records/filter.js';
import { RecordModel } from '../records/record.model.js';
import { label, loadFields, projectForList, resolveRefs } from '../records/record.service.js';
import { workspaceAccess } from '../workspaces/access.js';
import { analyze, groupSpec, metricSpec } from './analyzer.js';
import { Dashboard, Report } from './report.model.js';

const router = Router();
router.use(authenticate);

const MAX_WIDGETS = 30;
const base = { id: z.string().max(40).optional(), title: z.string().trim().max(80).default(''), w: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]).default(6), h: z.union([z.literal(1), z.literal(2)]).default(1) };
const widget = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('kpi'), config: z.object({ dataformId: objectId, metric: metricSpec, filter: filterSchema.nullish() }) }),
  z.object({
    ...base, type: z.literal('chart'),
    config: z.object({
      dataformId: objectId, chart: z.enum(['bar', 'line', 'pie']), groupBy: groupSpec, metric: metricSpec, filter: filterSchema.nullish(),
      limit: z.number().int().min(1).max(50).default(12),
    }),
  }),
  z.object({
    ...base, type: z.literal('list'),
    config: z.object({
      dataformId: objectId, filter: filterSchema.nullish(), sort: z.string().max(60).default('createdAt:desc'),
      columns: z.array(z.string().max(60)).max(5).default([]), limit: z.number().int().min(1).max(20).default(8),
    }),
  }),
  z.object({ ...base, type: z.literal('report'), config: z.object({ reportId: objectId }) }),
]);
const body = z.object({ name: z.string().trim().min(1).max(120), widgets: z.array(widget).max(MAX_WIDGETS).default([]) });
const idParams = z.object({ id: objectId });

const withIds = (widgets) => widgets.map((w) => ({ ...w, id: w.id || crypto.randomUUID() }));

function canEdit(req, dash) {
  return dash.scope === 'account' ? can(req.auth.role, 'account:update') : String(dash.owner) === req.auth.userId;
}

async function loadDashboard(req) {
  const dash = await Dashboard.findOne({ _id: req.params.id, account: req.auth.accountId });
  if (!dash || (dash.scope === 'user' && String(dash.owner) !== req.auth.userId)) throw notFound('Dashboard not found');
  return dash;
}

router.get('/', async (req, res) => {
  const data = await Dashboard.find({
    account: req.auth.accountId, $or: [{ scope: 'account' }, { owner: req.auth.userId }],
  }).select('name scope owner updatedAt').sort({ scope: 1, name: 1 }).lean();
  res.json({ data: data.map((d) => ({ ...d, editable: d.scope === 'account' ? can(req.auth.role, 'account:update') : true })) });
});

router.post('/', validate({ body: body.extend({ scope: z.enum(['account', 'user']) }) }), async (req, res) => {
  if (req.body.scope === 'account' && !can(req.auth.role, 'account:update')) throw forbidden('Only admins can create account dashboards');
  const dash = await Dashboard.create({ account: req.auth.accountId, owner: req.auth.userId, scope: req.body.scope, name: req.body.name, widgets: withIds(req.body.widgets) });
  res.status(201).json({ dashboard: dash });
});

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const dash = await loadDashboard(req);
  res.json({ dashboard: dash, editable: canEdit(req, dash) });
});

router.put('/:id', validate({ params: idParams, body }), async (req, res) => {
  const dash = await loadDashboard(req);
  if (!canEdit(req, dash)) throw forbidden();
  dash.name = req.body.name;
  dash.widgets = withIds(req.body.widgets);
  await dash.save();
  res.json({ dashboard: dash });
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const dash = await loadDashboard(req);
  if (!canEdit(req, dash)) throw forbidden();
  await dash.deleteOne();
  res.status(204).end();
});

// Widget data is always computed here with the *viewer's* access, never trusted from the stored widget.
async function dataformFor(req, id) {
  const dataform = await Dataform.findOne({ _id: id, account: req.auth.accountId });
  if (!dataform) throw notFound('The data behind this widget no longer exists');
  await workspaceAccess(req.auth, dataform.workspace);
  return dataform;
}

async function runList(req, dataform, { filter, q, sort, columns, limit }) {
  const fields = await loadFields(dataform._id);
  const visible = fields.filter((f) => f.visibility.list);
  const parts = [{ account: dataform.account, dataform: dataform._id }];
  const search = compileSearch(q, fields);
  const f = compileFilter(filter, fields);
  if (search) parts.push(search);
  if (f) parts.push(f);
  const rows = await RecordModel.find({ $and: parts }).sort(compileSort(sort, fields)).limit(limit).lean();
  const shown = columns?.length ? columns.map((k) => visible.find((x) => x.key === k)).filter(Boolean) : visible.filter((f) => f.key !== dataform.primaryField).slice(0, 4);
  // The record label already shows the display field, so it is not repeated as a column.
  return {
    type: 'list', dataform: { _id: dataform._id, name: dataform.name }, fields: shown.filter((f) => f.key !== dataform.primaryField),
    rows: projectForList(fields, rows).map((r) => ({ ...r, _label: label(dataform, r) })),
    refs: await resolveRefs(req.auth, dataform, shown, rows),
  };
}

router.post('/:id/widgets/:widgetId/data', validate({ params: z.object({ id: objectId, widgetId: z.string().max(40) }) }), async (req, res) => {
  const dash = await loadDashboard(req);
  const w = dash.widgets.find((x) => x.id === req.params.widgetId);
  if (!w) throw notFound('Widget not found');
  const c = w.config;

  if (w.type === 'report') {
    const report = await Report.findOne({ _id: c.reportId, account: req.auth.accountId });
    if (!report || (!report.shared && String(report.owner) !== req.auth.userId)) throw notFound('This report is not available to you');
    const dataform = await dataformFor(req, report.dataform);
    if (report.kind === 'list') return res.json(await runList(req, dataform, { ...report.config, columns: report.config.columns, limit: 10 }));
    const fields = await loadFields(dataform._id);
    return res.json({ type: 'analyzer', fields: fields.filter((f) => f.visibility.list), ...(await analyze({ auth: req.auth, dataform, fields, params: { page: 1, limit: 50, ...report.config } })) });
  }

  const dataform = await dataformFor(req, c.dataformId);
  if (w.type === 'list') return res.json(await runList(req, dataform, c));
  const fields = await loadFields(dataform._id);
  if (w.type === 'kpi') {
    const out = await analyze({ auth: req.auth, dataform, fields, params: { groupBy: [], metrics: [c.metric], filter: c.filter ?? undefined, page: 1, limit: 1 } });
    const mf = fields.find((f) => f.key === c.metric.field);
    return res.json({ type: 'kpi', value: out.totals.m0, metric: c.metric, metricLabel: c.metric.op === 'count' ? 'Records' : `${c.metric.op} of ${mf?.label ?? c.metric.field}`, dataform: { name: dataform.name } });
  }
  if (w.type === 'chart') {
    const out = await analyze({ auth: req.auth, dataform, fields, params: { groupBy: [c.groupBy], metrics: [c.metric], filter: c.filter ?? undefined, page: 1, limit: c.limit } });
    return res.json({ type: 'chart', chart: c.chart, ...out, fields: fields.filter((f) => f.visibility.list) });
  }
  throw badRequest('Unsupported widget');
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { compileFilter, compileSort, filterSchema } from '../records/filter.js';
import { loadFields } from '../records/record.service.js';
import { LEVEL, workspaceAccess } from '../workspaces/access.js';
import { analyze, analyzeSchema } from './analyzer.js';
import { Report } from './report.model.js';

const key = z.string().max(60);

// ---- Grouped Table Analyzer: mounted at /dataforms/:id/analyze ----
export const analyzeRouter = Router({ mergeParams: true });
analyzeRouter.use(authenticate);
analyzeRouter.post('/', validate({ params: z.object({ id: objectId }), body: analyzeSchema }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  const fields = await loadFields(dataform._id);
  res.json(await analyze({ auth: req.auth, dataform, fields, params: req.body }));
});

// ---- Reports: mounted at /reports ----
const router = Router();
router.use(authenticate);

const listConfig = z.object({
  columns: z.array(key).max(100).default([]),
  filter: filterSchema.nullish(),
  sort: z.string().max(60).optional(),
  q: z.string().max(100).optional(),
});
const analyzerConfig = analyzeSchema.omit({ page: true, limit: true });
const reportBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  shared: z.boolean().default(false),
  kind: z.enum(['list', 'analyzer']),
  config: z.unknown(),
});
const idParams = z.object({ id: objectId });

async function parsedConfig(kind, raw, dataform) {
  const schema = kind === 'list' ? listConfig : analyzerConfig;
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest('Invalid report configuration', result.error.issues.map((i) => ({ path: `config.${i.path.join('.')}`, message: i.message })));
  }
  const fields = await loadFields(dataform._id);
  compileFilter(result.data.filter, fields);
  if (kind === 'list') {
    if (result.data.sort) compileSort(result.data.sort, fields);
  }
  return result.data;
}

router.get('/', validate({ query: z.object({ workspaceId: objectId }) }), async (req, res) => {
  const { workspace } = await workspaceAccess(req.auth, req.query.workspaceId);
  const reports = await Report.find({
    account: req.auth.accountId, workspace: workspace._id, $or: [{ shared: true }, { owner: req.auth.userId }],
  }).sort({ name: 1 }).populate('dataform', 'name').populate('owner', 'name').lean();
  res.json({ data: reports.map((r) => ({ ...r, mine: String(r.owner._id) === req.auth.userId })) });
});

router.post('/', validate({ body: reportBody.extend({ dataformId: objectId }) }), async (req, res) => {
  const dataform = await Dataform.findOne({ _id: req.body.dataformId, account: req.auth.accountId });
  if (!dataform) throw notFound('Dataform not found');
  const { level } = await workspaceAccess(req.auth, dataform.workspace);
  if (req.body.shared && level < LEVEL.editor) throw forbidden('Only editors can share reports');
  const config = await parsedConfig(req.body.kind, req.body.config, dataform);
  const report = await Report.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, owner: req.auth.userId,
    name: req.body.name, description: req.body.description, kind: req.body.kind, shared: req.body.shared, config,
  });
  res.status(201).json({ report });
});

async function loadReport(req) {
  const report = await Report.findOne({ _id: req.params.id, account: req.auth.accountId });
  if (!report || (!report.shared && String(report.owner) !== req.auth.userId)) throw notFound('Report not found');
  const access = await workspaceAccess(req.auth, report.workspace); // 404 if the workspace is no longer visible
  return { report, access };
}

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const { report } = await loadReport(req);
  res.json({ report });
});

router.patch('/:id', validate({ params: idParams, body: reportBody.omit({ kind: true }) }), async (req, res) => {
  const { report, access } = await loadReport(req);
  if (String(report.owner) !== req.auth.userId && access.level < LEVEL.admin) throw forbidden('Only the owner can change this report');
  if (req.body.shared && access.level < LEVEL.editor) throw forbidden('Only editors can share reports');
  const dataform = await Dataform.findById(report.dataform);
  report.config = await parsedConfig(report.kind, req.body.config, dataform);
  report.name = req.body.name;
  report.description = req.body.description;
  report.shared = req.body.shared;
  report.markModified('config');
  await report.save();
  res.json({ report });
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const { report, access } = await loadReport(req);
  if (String(report.owner) !== req.auth.userId && access.level < LEVEL.admin) throw forbidden('Only the owner can delete this report');
  await report.deleteOne();
  res.status(204).end();
});

export default router;

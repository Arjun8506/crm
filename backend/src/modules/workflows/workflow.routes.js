import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { Dataform, FieldDefinition } from '../dataforms/dataform.model.js';
import { buildContext } from '../formulas/context.js';
import { FormulaError, evaluateExpression, parse, referencedFields } from '../formulas/formula.js';
import { encrypt, decrypt } from '../integrations/secrets.js';
import { Job } from '../queue/job.model.js';
import { cancelJobs } from '../queue/queue.js';
import { RecordModel } from '../records/record.model.js';
import { User } from '../users/user.model.js';
import { LEVEL, workspaceAccess } from '../workspaces/access.js';
import { audit } from '../audit/audit.js';
import { executeExecution } from './engine.js';
import { nextRun } from './schedule.js';
import { validateWorkflow, workflowBody } from './schema.js';
import { Workflow, WorkflowExecution } from './workflow.model.js';

const router = Router();
router.use(authenticate);

const idParams = z.object({ id: objectId });

async function loadWorkflow(req, minLevel = 'admin') {
  const workflow = await Workflow.findOne({ _id: req.params.id, account: req.auth.accountId }).select('+webhookSecret');
  if (!workflow) throw notFound('Workflow not found');
  const access = await workspaceAccess(req.auth, workflow.workspace, minLevel);
  return { workflow, access };
}

async function loadDataformFor(req, dataformId, minLevel) {
  const dataform = await Dataform.findOne({ _id: dataformId, account: req.auth.accountId });
  if (!dataform) throw notFound('Dataform not found');
  const access = await workspaceAccess(req.auth, dataform.workspace, minLevel);
  const fields = await FieldDefinition.find({ dataform: dataform._id }).sort({ order: 1 }).lean();
  return { dataform, access, fields };
}

const hasWebhook = (w) => w.actions.some((a) => a.type === 'webhook');
const present = (w, { secret = false } = {}) => {
  const obj = w.toObject ? w.toObject() : w;
  const { webhookSecret, ...rest } = obj;
  return { ...rest, ...(secret && hasWebhook(obj) && webhookSecret ? { webhookSecret: decrypt(webhookSecret) } : {}) };
};

// ---- formula tester: evaluate an expression against a real record or sample values ----
router.post(
  '/test-formula',
  validate({ body: z.object({ dataformId: objectId, expression: z.string().max(1000), recordId: objectId.optional(), sample: z.record(z.string(), z.unknown()).optional() }) }),
  async (req, res) => {
    const { dataform, fields } = await loadDataformFor(req, req.body.dataformId, 'editor');
    const known = new Set([...fields.map((f) => f.key), ...fields.filter((f) => f.type === 'relationship').map((f) => `${f.key}_label`), 'record', 'old', 'user', 'workflow']);
    try {
      const ast = parse(req.body.expression);
      const unknown = [...referencedFields(ast)].filter((k) => !known.has(k));
      if (unknown.length) return res.json({ ok: false, error: `Unknown field {${unknown[0]}}. Available fields: ${fields.map((f) => f.key).join(', ')}` });
      let before = req.body.sample ?? {}; let recordId;
      if (req.body.recordId) {
        const record = await RecordModel.findOne({ _id: req.body.recordId, account: req.auth.accountId, dataform: dataform._id }).lean();
        if (!record) throw notFound('Record not found');
        before = record.data; recordId = record._id;
      }
      const actor = await User.findById(req.auth.userId).select('name email').lean();
      const ctx = await buildContext({ account: dataform.account, dataform, fields, recordId, before, after: before, actor });
      const value = evaluateExpression(req.body.expression, ctx.formula);
      const type = value === null ? 'empty' : value instanceof Date ? 'date' : Array.isArray(value) ? 'list' : typeof value;
      return res.json({ ok: true, result: value instanceof Date ? value.toISOString() : value, type, references: [...referencedFields(ast)] });
    } catch (err) {
      if (err instanceof FormulaError) return res.json({ ok: false, error: err.message });
      throw err;
    }
  },
);

// ---- executions (declared before "/:id" so "executions" is not read as an id) ----
router.get('/executions/:id', validate({ params: idParams }), async (req, res) => {
  const exec = await WorkflowExecution.findOne({ _id: req.params.id, account: req.auth.accountId }).lean();
  if (!exec) throw notFound('Run not found');
  await workspaceAccess(req.auth, exec.workspace, 'admin');
  res.json({ execution: exec });
});

router.post('/executions/:id/retry', validate({ params: idParams }), async (req, res) => {
  const exec = await WorkflowExecution.findOne({ _id: req.params.id, account: req.auth.accountId });
  if (!exec) throw notFound('Run not found');
  await workspaceAccess(req.auth, exec.workspace, 'admin');
  if (exec.status !== 'failed' && exec.status !== 'partial') throw conflict('Only failed runs can be retried');
  exec.status = 'queued'; exec.error = undefined; exec.finishedAt = undefined; exec.attempts = 0;
  await exec.save();
  await Job.updateOne({ type: 'workflow.execute', 'payload.executionId': String(exec._id) }, { $set: { status: 'queued', attempts: 0, runAt: new Date(), lastError: null }, $unset: { finishedAt: '' } });
  res.json({ execution: exec });
});

// ---- workflows ----
// Builders (workspace admins) see everything. Editors only need to see the manual workflows they can run.
router.get('/', validate({ query: z.object({ workspaceId: objectId, dataformId: objectId.optional(), manual: z.enum(['true']).optional() }) }), async (req, res) => {
  const { workspace, level } = await workspaceAccess(req.auth, req.query.workspaceId);
  const filter = { account: req.auth.accountId, workspace: workspace._id, ...(req.query.dataformId ? { dataform: req.query.dataformId } : {}) };
  if (level < LEVEL.admin || req.query.manual) {
    if (level < LEVEL.editor) throw forbidden();
    Object.assign(filter, { enabled: true, 'trigger.type': 'manual' });
  }
  const data = await Workflow.find(filter).sort({ name: 1 }).lean();
  res.json({ data: level < LEVEL.admin ? data.map((w) => ({ _id: w._id, name: w.name, description: w.description, dataform: w.dataform, trigger: w.trigger })) : data });
});

router.post('/', validate({ body: workflowBody }), async (req, res) => {
  const { dataform, access, fields } = await loadDataformFor(req, req.body.dataformId, 'admin');
  const def = await validateWorkflow(req.body, { account: dataform.account, workspace: access.workspace, dataform, fields });
  const workflow = await Workflow.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, name: def.name, description: def.description, trigger: def.trigger,
    conditions: def.conditions, actions: def.actions, onError: def.onError, enabled: false, createdBy: req.auth.userId, webhookSecret: encrypt(crypto.randomBytes(24).toString('hex')),
  });
  await audit(req, 'workflow.created', { type: 'workflow', id: workflow._id, summary: workflow.name });
  res.status(201).json({ workflow: present(await Workflow.findById(workflow._id).select('+webhookSecret'), { secret: true }) });
});

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const { workflow } = await loadWorkflow(req);
  res.json({ workflow: present(workflow, { secret: true }) });
});

router.put('/:id', validate({ params: idParams, body: workflowBody }), async (req, res) => {
  const { workflow, access } = await loadWorkflow(req);
  if (String(req.body.dataformId) !== String(workflow.dataform)) throw badRequest('A workflow cannot be moved to another dataform. Create a new one instead');
  const { dataform, fields } = await loadDataformFor(req, workflow.dataform, 'admin');
  const def = await validateWorkflow(req.body, { account: dataform.account, workspace: access.workspace, dataform, fields });
  Object.assign(workflow, { name: def.name, description: def.description, trigger: def.trigger, conditions: def.conditions, actions: def.actions, onError: def.onError });
  workflow.version += 1;
  workflow.markModified('trigger'); workflow.markModified('conditions'); workflow.markModified('actions');
  if (def.trigger.type === 'schedule' && workflow.enabled) workflow.nextRunAt = nextRun(def.trigger.schedule);
  if (def.trigger.type !== 'schedule') workflow.nextRunAt = undefined;
  await workflow.save();
  await audit(req, 'workflow.updated', { type: 'workflow', id: workflow._id, summary: `${workflow.name} (v${workflow.version})` });
  res.json({ workflow: present(workflow, { secret: true }) });
});

// Pause / resume. Pausing stops new triggers; runs already queued are cancelled with /cancel-pending.
router.patch('/:id/enabled', validate({ params: idParams, body: z.object({ enabled: z.boolean() }) }), async (req, res) => {
  const { workflow } = await loadWorkflow(req);
  workflow.enabled = req.body.enabled;
  workflow.nextRunAt = req.body.enabled && workflow.trigger.type === 'schedule' ? nextRun(workflow.trigger.schedule) : undefined;
  await workflow.save();
  await audit(req, workflow.enabled ? 'workflow.enabled' : 'workflow.paused', { type: 'workflow', id: workflow._id, summary: workflow.name });
  res.json({ workflow: present(workflow) });
});

router.post('/:id/cancel-pending', validate({ params: idParams }), async (req, res) => {
  const { workflow } = await loadWorkflow(req);
  const pending = await WorkflowExecution.find({ account: workflow.account, workflow: workflow._id, status: { $in: ['queued', 'running'] } }).select('_id').lean();
  const ids = pending.map((p) => String(p._id));
  await cancelJobs({ type: { $in: ['workflow.execute'] }, 'payload.executionId': { $in: ids } });
  await cancelJobs({ type: 'workflow.schedule', 'payload.workflowId': String(workflow._id) });
  await WorkflowExecution.updateMany({ _id: { $in: ids } }, { $set: { status: 'cancelled', finishedAt: new Date(), error: 'Cancelled by an administrator' } });
  res.json({ cancelled: ids.length });
});

router.post('/:id/rotate-secret', validate({ params: idParams }), async (req, res) => {
  const { workflow } = await loadWorkflow(req);
  const secret = crypto.randomBytes(24).toString('hex');
  workflow.webhookSecret = encrypt(secret);
  await workflow.save();
  res.json({ webhookSecret: secret });
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const { workflow } = await loadWorkflow(req);
  const pending = await WorkflowExecution.find({ workflow: workflow._id, status: { $in: ['queued', 'running'] } }).select('_id').lean();
  await cancelJobs({ type: 'workflow.execute', 'payload.executionId': { $in: pending.map((p) => String(p._id)) } });
  await WorkflowExecution.updateMany({ _id: { $in: pending.map((p) => p._id) } }, { $set: { status: 'cancelled', finishedAt: new Date(), error: 'The workflow was deleted' } });
  await workflow.deleteOne(); // run history is kept (it records the workflow name)
  await audit(req, 'workflow.deleted', { type: 'workflow', id: workflow._id, summary: workflow.name });
  res.status(204).end();
});

router.get('/:id/executions', validate({ params: idParams, query: z.object({ status: z.string().max(20).optional(), page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) }), async (req, res) => {
  const workflow = await Workflow.findOne({ _id: req.params.id, account: req.auth.accountId }).lean();
  if (!workflow) throw notFound('Workflow not found');
  await workspaceAccess(req.auth, workflow.workspace, 'admin');
  const q = { account: req.auth.accountId, workflow: workflow._id, ...(req.query.status ? { status: req.query.status } : {}) };
  const { page, limit } = req.query;
  const [data, total] = await Promise.all([
    WorkflowExecution.find(q).select('-snapshot').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    WorkflowExecution.countDocuments(q),
  ]);
  res.json({ data, total, page, limit });
});

// Runs a manual workflow on one record, right now, and returns what happened.
router.post('/:id/run', validate({ params: idParams, body: z.object({ recordId: objectId }) }), async (req, res) => {
  const { workflow } = await loadWorkflow(req, 'editor');
  if (workflow.trigger.type !== 'manual') throw badRequest('Only workflows with a manual trigger can be run by hand');
  if (!workflow.enabled) throw conflict('This workflow is paused');
  const record = await RecordModel.findOne({ _id: req.body.recordId, account: req.auth.accountId, dataform: workflow.dataform }).select('_id').lean();
  if (!record) throw notFound('Record not found');
  const exec = await WorkflowExecution.create({
    account: workflow.account, workspace: workflow.workspace, workflow: workflow._id, workflowName: workflow.name, dataform: workflow.dataform, record: record._id,
    event: 'manual', trigger: 'manual', status: 'queued', chain: [workflow._id], actor: req.auth.userId,
  });
  res.status(201).json({ execution: await executeExecution(exec._id, { inline: true }) });
});

export default router;

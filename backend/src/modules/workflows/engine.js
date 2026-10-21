import { buildContext } from '../formulas/context.js';
import { Dataform, FieldDefinition } from '../dataforms/dataform.model.js';
import { notify } from '../notifications/notification.service.js';
import { enqueue, registerHandler } from '../queue/queue.js';
import { RecordModel } from '../records/record.model.js';
import { User } from '../users/user.model.js';
import { Workspace } from '../workspaces/workspace.model.js';
import { runAction } from './actions.js';
import { evaluateTree } from './conditions.js';
import { nextRun } from './schedule.js';
import { Workflow, WorkflowExecution } from './workflow.model.js';

// Executes one queued WorkflowExecution. Progress is saved after every action, and a retry resumes at the first action
// that has not succeeded, so retries never repeat work (no duplicate emails, tasks or webhooks for completed steps).


async function finish(exec, status, extra = {}) {
  await WorkflowExecution.updateOne({ _id: exec._id }, { $set: { status, finishedAt: new Date(), ...extra } });
  if (['succeeded', 'partial', 'failed'].includes(status)) await Workflow.updateOne({ _id: exec.workflow }, { $set: { lastRunAt: new Date() } });
}

// inline = a manual run: executed immediately with no automatic retries, and the outcome is returned to the caller.
export async function executeExecution(executionId, { inline = false } = {}) {
  const claimed = await WorkflowExecution.findOneAndUpdate(
    { _id: executionId, status: { $in: ['queued', 'running'] } },
    { $set: { status: 'running' }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!claimed) return WorkflowExecution.findById(executionId);
  const exec = claimed;
  if (!exec.startedAt) await WorkflowExecution.updateOne({ _id: exec._id }, { $set: { startedAt: new Date() } });

  const workflow = await Workflow.findById(exec.workflow).lean();
  if (!workflow) { await finish(exec, 'cancelled', { error: 'The workflow was deleted' }); return WorkflowExecution.findById(exec._id); }
  if (!workflow.enabled && !inline) { await finish(exec, 'cancelled', { error: 'The workflow was paused before this run started' }); return WorkflowExecution.findById(exec._id); }

  const dataform = await Dataform.findById(exec.dataform);
  const workspace = await Workspace.findById(exec.workspace);
  if (!dataform || !workspace) { await finish(exec, 'cancelled', { error: 'The dataform no longer exists' }); return WorkflowExecution.findById(exec._id); }
  const fields = await FieldDefinition.find({ dataform: dataform._id }).sort({ order: 1 }).lean();
  const byKey = new Map(fields.map((f) => [f.key, f]));

  // Manual and scheduled runs read the record now; save/delete runs use the snapshot taken when the change happened.
  const live = ['manual', 'schedule'].includes(exec.event) ? await RecordModel.findOne({ _id: exec.record, account: exec.account }).lean() : null;
  if (['manual', 'schedule'].includes(exec.event) && !live) { await finish(exec, 'skipped', { error: 'The record no longer exists' }); return WorkflowExecution.findById(exec._id); }
  const before = live ? live.data : exec.snapshot?.before ?? null;
  const after = live ? live.data : exec.snapshot?.after ?? null;
  const current = exec.event === 'delete' ? before : after;

  const creator = await User.findById(workflow.createdBy).select('name email').lean();
  if (!creator) { await finish(exec, 'failed', { error: 'The user who created this workflow no longer exists' }); return WorkflowExecution.findById(exec._id); }
  const ctx = await buildContext({ account: exec.account, dataform, fields, recordId: exec.record, before, after, actor: creator, workflow });

  // Scheduled and manual runs test the conditions here (save triggers already tested them when queueing).
  if (['manual', 'schedule'].includes(exec.event) && workflow.conditions) {
    let matched;
    try { matched = evaluateTree(workflow.conditions, { fields: byKey, current, formula: ctx.formula }); } catch (err) {
      await finish(exec, 'failed', { error: `Could not evaluate the conditions: ${err.message}` });
      return WorkflowExecution.findById(exec._id);
    }
    if (!matched) { await finish(exec, 'skipped', { conditionsMatched: false, error: 'The conditions did not match this record' }); return WorkflowExecution.findById(exec._id); }
  }

  const source = { depth: exec.depth, chain: exec.chain.slice(0, -1) }; // chain already includes this workflow
  const done = new Map(exec.actions.filter((a) => a.status !== 'failed').map((a) => [a.index, a.toObject()]));
  const results = [...done.values()];
  let firstError = null;

  for (const [index, action] of workflow.actions.entries()) {
    if (done.has(index)) continue;
    let result;
    try {
      result = await runAction(action, { workflow, dataform, fields, byKey, workspace, recordId: exec.record, event: exec.event, snapshot: exec.snapshot, current, ctx, creator, source, execution: exec, index });
    } catch (err) {
      result = { status: 'failed', detail: String(err.message ?? err).slice(0, 500) };
    }
    results.push({ index, type: action.type, status: result.status, detail: result.detail, at: new Date() });
    await WorkflowExecution.updateOne({ _id: exec._id }, { $set: { actions: results.sort((x, y) => x.index - y.index) } });
    if (result.status === 'failed') {
      firstError ??= result.detail;
      if (workflow.onError === 'stop') break;
    }
  }

  if (!firstError) { await finish(exec, 'succeeded', { error: null }); return WorkflowExecution.findById(exec._id); }
  if (workflow.onError === 'continue') { await finish(exec, 'partial', { error: firstError }); return WorkflowExecution.findById(exec._id); }
  if (inline) { await finish(exec, 'failed', { error: firstError }); return WorkflowExecution.findById(exec._id); }
  // Back to the queue: the job retries with backoff and resumes at the failed action.
  await WorkflowExecution.updateOne({ _id: exec._id }, { $set: { status: 'queued', error: firstError } });
  throw new Error(firstError);
}

async function failPermanently(executionId, err) {
  const exec = await WorkflowExecution.findOneAndUpdate({ _id: executionId, status: { $in: ['queued', 'running'] } }, { $set: { status: 'failed', finishedAt: new Date(), error: String(err.message).slice(0, 1000) } }, { returnDocument: 'after' });
  if (!exec) return;
  await Workflow.updateOne({ _id: exec.workflow }, { $set: { lastRunAt: new Date() } });
  const workflow = await Workflow.findById(exec.workflow).select('createdBy name').lean();
  if (workflow) {
    await notify({ account: exec.account, recipients: [workflow.createdBy], type: 'workflow_failed', title: `Workflow "${workflow.name}" failed`, body: String(err.message).slice(0, 250), link: `/w/${exec.workspace}/workflows/${exec.workflow}` });
  }
}

registerHandler('workflow.execute', ({ executionId }) => executeExecution(executionId), { onFinalFailure: ({ executionId }, err) => failPermanently(executionId, err) });

// ---- scheduled workflows ----
const MAX_RECORDS_PER_RUN = 2000;

// For one due run: queue an execution for every record of the dataform (conditions are tested when each one runs).
registerHandler('workflow.schedule', async ({ workflowId, runStamp }) => {
  const workflow = await Workflow.findById(workflowId).lean();
  if (!workflow?.enabled) return;
  const cursor = RecordModel.find({ account: workflow.account, dataform: workflow.dataform }).select('_id').limit(MAX_RECORDS_PER_RUN).lean().cursor();
  for await (const r of cursor) {
    try {
      const exec = await WorkflowExecution.create({
        account: workflow.account, workspace: workflow.workspace, workflow: workflow._id, workflowName: workflow.name, dataform: workflow.dataform, record: r._id,
        event: 'schedule', trigger: 'schedule', status: 'queued', chain: [workflow._id], actor: workflow.createdBy, dedupeKey: `${workflow._id}:${r._id}:schedule:${runStamp}`,
      });
      await enqueue('workflow.execute', { executionId: String(exec._id), workflowId: String(workflow._id) }, { dedupeKey: `exec:${exec._id}` });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
});

// Called every minute by the scheduler. Each due workflow is claimed atomically (its nextRunAt moves forward in the same
// write), so several API instances never queue the same run twice.
export async function runDueWorkflows(now = new Date()) {
  let queued = 0;
  for (let i = 0; i < 100; i++) {
    const due = await Workflow.findOne({ enabled: true, 'trigger.type': 'schedule', nextRunAt: { $lte: now } }).lean();
    if (!due) break;
    const next = nextRun(due.trigger.schedule, now);
    const claimed = await Workflow.findOneAndUpdate({ _id: due._id, nextRunAt: due.nextRunAt }, { $set: { nextRunAt: next } });
    if (!claimed) continue; // another instance got it
    await enqueue('workflow.schedule', { workflowId: String(due._id), runStamp: due.nextRunAt.getTime() }, { dedupeKey: `sched:${due._id}:${due.nextRunAt.getTime()}` });
    queued++;
  }
  return queued;
}

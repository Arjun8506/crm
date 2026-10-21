import { ApiError } from '../../utils/errors.js';
import { buildContext } from '../formulas/context.js';
import { renderTemplate } from '../formulas/formula.js';
import { enqueue } from '../queue/queue.js';
import { User } from '../users/user.model.js';
import { evaluateTree } from './conditions.js';
import { computeValue } from './values.js';
import { Workflow, WorkflowExecution } from './workflow.model.js';

// Where record changes meet the workflow engine.
//  - runPreSave:     synchronous, runs BEFORE a save or delete. Can block it (validation error) or adjust values (set field).
//  - triggerPostSave: runs after the change was written; queues a background execution for each matching workflow.
// Loop protection: every workflow-caused write carries its depth and the chain of workflows that led to it.

export const MAX_DEPTH = 3;
export const ROOT = Object.freeze({ depth: 0, chain: [] });
export const nextSource = (source, workflow) => ({ depth: source.depth + 1, chain: [...source.chain, workflow._id] });

const inChain = (source, w) => source.chain.some((id) => String(id) === String(w._id));
const eligibleEvent = (w, event) => event === 'delete' || event === 'manual' || !w.trigger.events || w.trigger.events.includes(event);

async function actorFor(userId) {
  return userId ? User.findById(userId).select('name email').lean() : null;
}

const baseExecution = (w, { dataform, recordId, event, source, actor }) => ({
  account: w.account, workspace: w.workspace, workflow: w._id, workflowName: w.name, dataform: dataform._id, record: recordId,
  event, trigger: w.trigger.type, depth: source.depth, chain: [...source.chain, w._id], actor,
});

function test(w, { fields, current, ctx }) {
  return evaluateTree(w.conditions, { fields: new Map(fields.map((f) => [f.key, f])), current, formula: ctx.formula });
}

// Runs "before save" / "before delete" workflows. Returns the (possibly adjusted) record data.
// A workflow that errors never blocks the user: the failure is recorded in its history instead (fail-open).
export async function runPreSave({ dataform, fields, event, before, after, recordId, auth, source = ROOT }) {
  const type = event === 'delete' ? 'pre_delete' : 'pre_save';
  const all = await Workflow.find({ account: dataform.account, dataform: dataform._id, enabled: true, 'trigger.type': type }).sort({ createdAt: 1 }).lean();
  const workflows = all.filter((w) => eligibleEvent(w, event) && !inChain(source, w));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  let current = event === 'delete' ? { ...before } : { ...after };
  if (!workflows.length) return { data: current };
  const actor = await actorFor(auth?.userId);

  for (const w of workflows) {
    const exec = { ...baseExecution(w, { dataform, recordId, event, source, actor: auth?.userId }), startedAt: new Date(), finishedAt: new Date(), actions: [] };
    try {
      let ctx = await buildContext({ account: dataform.account, dataform, fields, recordId, before, after: current, actor, workflow: w });
      if (!test(w, { fields, current, ctx })) continue;
      exec.conditionsMatched = true;

      for (const [index, action] of w.actions.entries()) {
        if (action.type === 'validation_error') {
          const message = renderTemplate(action.message, ctx.template);
          await WorkflowExecution.create({ ...exec, status: 'blocked', error: message, actions: [...exec.actions, { index, type: action.type, status: 'ok', detail: 'Blocked the save', at: new Date() }] });
          throw new ApiError(400, 'WORKFLOW_VALIDATION', message, [{ path: `workflow:${w.name}`, message }]);
        }
        try {
          const target = byKey.get(action.field);
          if (!target) throw new Error(`The field ${action.field} no longer exists`);
          const value = computeValue(action, target, ctx.formula);
          current = { ...current, [action.field]: value };
          ctx = await buildContext({ account: dataform.account, dataform, fields, recordId, before, after: current, actor, workflow: w });
          exec.actions.push({ index, type: action.type, status: 'ok', detail: `${target.label} set`, at: new Date() });
        } catch (err) {
          exec.actions.push({ index, type: action.type, status: 'failed', detail: String(err.message).slice(0, 500), at: new Date() });
        }
      }
      const failed = exec.actions.some((a) => a.status === 'failed');
      await WorkflowExecution.create({ ...exec, status: failed ? 'failed' : 'succeeded', error: failed ? exec.actions.find((a) => a.status === 'failed').detail : undefined });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      await WorkflowExecution.create({ ...exec, status: 'failed', error: `Could not evaluate the conditions: ${String(err.message).slice(0, 400)}` }).catch(() => {});
    }
  }
  return { data: current };
}

// Queues a background execution for every matching "after save" / "after delete" workflow.
export async function triggerPostSave({ dataform, fields, event, before, after, recordId, version, actorId, source = ROOT }) {
  try {
    const type = event === 'delete' ? 'post_delete' : 'post_save';
    const all = await Workflow.find({ account: dataform.account, dataform: dataform._id, enabled: true, 'trigger.type': type }).sort({ createdAt: 1 }).lean();
    const workflows = all.filter((w) => eligibleEvent(w, event));
    if (!workflows.length) return;
    const actor = await actorFor(actorId);
    const ctx = await buildContext({ account: dataform.account, dataform, fields, recordId, before, after, actor });
    const current = event === 'delete' ? before : after;

    for (const w of workflows) {
      const exec = baseExecution(w, { dataform, recordId, event, source, actor: actorId });
      let matched;
      try { matched = test(w, { fields, current, ctx }); } catch (err) {
        await WorkflowExecution.create({ ...exec, status: 'failed', error: `Could not evaluate the conditions: ${String(err.message).slice(0, 400)}`, finishedAt: new Date() }).catch(() => {});
        continue;
      }
      if (!matched) continue;
      // Loop protection only matters for runs that would actually fire.
      if (inChain(source, w) || source.depth >= MAX_DEPTH) {
        await WorkflowExecution.create({ ...exec, status: 'skipped', conditionsMatched: true, error: inChain(source, w) ? 'Skipped to prevent a loop: this workflow caused the change that triggered it' : `Skipped: workflows triggered by workflows can only go ${MAX_DEPTH} levels deep`, finishedAt: new Date() }).catch(() => {});
        continue;
      }
      try {
        const doc = await WorkflowExecution.create({ ...exec, status: 'queued', conditionsMatched: true, snapshot: { before, after }, dedupeKey: `${w._id}:${recordId}:${event}:${version}` });
        await enqueue('workflow.execute', { executionId: String(doc._id), workflowId: String(w._id) }, { dedupeKey: `exec:${doc._id}` });
      } catch (err) {
        if (err.code !== 11000) throw err; // duplicate trigger for the same change: already queued
      }
    }
  } catch (err) {
    // The user's change already succeeded; a failure here must never turn into an error for them.
    console.error('[workflows] could not queue post-save workflows:', err.message);
  }
}

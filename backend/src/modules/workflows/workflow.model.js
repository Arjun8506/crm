import mongoose from 'mongoose';

const { ObjectId, Mixed } = mongoose.Schema.Types;

// A workflow is stored as validated JSON: a trigger, a condition tree and an ordered list of actions.
// The definition is checked against the dataform's real fields on every save (see schema.js).
const workflowSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: 'Account', required: true },
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    dataform: { type: ObjectId, ref: 'Dataform', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    // New workflows start paused so they can be reviewed before they touch any data.
    enabled: { type: Boolean, default: false },
    trigger: { type: Mixed, required: true },
    conditions: { type: Mixed, default: null },
    actions: { type: [Mixed], default: [] },
    // 'stop': a failing action ends the run (retries resume from it). 'continue': the remaining actions still run.
    onError: { type: String, enum: ['stop', 'continue'], default: 'stop' },
    // Signs outbound webhook calls so receivers can verify they came from this workflow.
    webhookSecret: { type: String, select: false },
    nextRunAt: Date,
    lastRunAt: Date,
    version: { type: Number, default: 1 },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
workflowSchema.index({ account: 1, dataform: 1, enabled: 1, 'trigger.type': 1 });
workflowSchema.index({ enabled: 1, nextRunAt: 1 }, { partialFilterExpression: { nextRunAt: { $type: 'date' } } });
workflowSchema.index({ account: 1, workspace: 1 });

// One document per run: what triggered it, whether the conditions matched, and the outcome of every action.
// Retries resume at the first action that has not succeeded, so a retry never repeats work that already happened.
const executionSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  workspace: { type: ObjectId, required: true },
  workflow: { type: ObjectId, ref: 'Workflow', required: true },
  workflowName: { type: String, maxlength: 120 },
  dataform: { type: ObjectId, required: true },
  record: { type: ObjectId },
  event: { type: String, enum: ['create', 'update', 'delete', 'manual', 'schedule'], required: true },
  trigger: { type: String, required: true },
  status: { type: String, enum: ['queued', 'running', 'succeeded', 'partial', 'failed', 'blocked', 'skipped', 'cancelled'], default: 'queued' },
  conditionsMatched: Boolean,
  // `type: { type: String }` because a bare `type` key inside a sub-schema is read by Mongoose as a type declaration.
  actions: { type: [{ _id: false, index: Number, type: { type: String }, status: { type: String, enum: ['ok', 'failed', 'skipped'] }, detail: { type: String, maxlength: 500 }, at: Date }], default: [] },
  error: { type: String, maxlength: 1000 },
  attempts: { type: Number, default: 0 },
  // Loop protection: how many workflow-caused writes deep this run is, and which workflows are already in the chain.
  depth: { type: Number, default: 0 },
  chain: { type: [ObjectId], default: [] },
  snapshot: { type: Mixed },
  actor: { type: ObjectId, ref: 'User' },
  dedupeKey: { type: String, maxlength: 200 },
  startedAt: Date,
  finishedAt: Date,
  createdAt: { type: Date, default: Date.now },
  expireAt: { type: Date, default: () => new Date(Date.now() + 90 * 864e5), index: { expireAfterSeconds: 0 } },
});
executionSchema.index({ account: 1, workflow: 1, createdAt: -1 });
executionSchema.index({ account: 1, workspace: 1, createdAt: -1 });
executionSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });

export const Workflow = mongoose.model('Workflow', workflowSchema);
export const WorkflowExecution = mongoose.model('WorkflowExecution', executionSchema);

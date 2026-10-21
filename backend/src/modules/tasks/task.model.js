import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
const NEVER = new Date('9999-12-31T00:00:00Z');

const taskSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: 'Account', required: true },
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    // Optional link to the record the task is about.
    dataform: { type: ObjectId, ref: 'Dataform' },
    record: { type: ObjectId, ref: 'Record' },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    assignees: { type: [{ type: ObjectId, ref: 'User' }], default: [] },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
    due: Date,
    // Always set (undated tasks sort last) so "due soonest first" paginates correctly in MongoDB.
    dueSort: { type: Date, default: NEVER },
    reminderAt: Date,
    completedAt: Date,
    createdBy: { type: ObjectId, ref: 'User', required: true },
    // Claimed atomically by the scheduler so each notification is sent once even with several API instances.
    reminderSentAt: Date,
    dueSoonNotifiedAt: Date,
    overdueNotifiedAt: Date,
  },
  { timestamps: true },
);
taskSchema.pre('validate', function setDueSort() {
  this.dueSort = this.due ?? NEVER;
});
taskSchema.index({ account: 1, assignees: 1, status: 1, dueSort: 1 });
taskSchema.index({ account: 1, workspace: 1, status: 1, dueSort: 1 });
taskSchema.index({ account: 1, record: 1 }, { sparse: true });
taskSchema.index({ reminderAt: 1, reminderSentAt: 1, status: 1 }, { sparse: true });
taskSchema.index({ due: 1, status: 1 }, { sparse: true });

const activitySchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  task: { type: ObjectId, ref: 'Task', required: true },
  user: { type: ObjectId, ref: 'User' },
  action: { type: String, enum: ['create', 'update'], required: true },
  changes: { type: [{ _id: false, field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed }], default: [] },
  at: { type: Date, default: Date.now },
});
activitySchema.index({ task: 1, at: -1 });

export const Task = mongoose.model('Task', taskSchema);
export const TaskActivity = mongoose.model('TaskActivity', activitySchema);

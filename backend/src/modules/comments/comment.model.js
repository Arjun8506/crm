import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// A comment belongs to exactly one target: a record or a task. Replies are one level deep.
const commentSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: 'Account', required: true },
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    dataform: { type: ObjectId, ref: 'Dataform' },
    record: { type: ObjectId, ref: 'Record' },
    task: { type: ObjectId, ref: 'Task' },
    author: { type: ObjectId, ref: 'User', required: true },
    parent: { type: ObjectId, ref: 'Comment', default: null },
    body: { type: String, required: true, maxlength: 5000 },
    mentions: { type: [{ type: ObjectId, ref: 'User' }], default: [] },
    editedAt: Date,
  },
  { timestamps: true },
);
commentSchema.index({ account: 1, record: 1, createdAt: 1 }, { sparse: true });
commentSchema.index({ account: 1, task: 1, createdAt: 1 }, { sparse: true });
commentSchema.index({ parent: 1 });

// "Following" a record = subscribing to its discussion. Created manually or automatically
// (commenting, being mentioned, creating the record).
const followSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  workspace: { type: ObjectId, required: true },
  dataform: { type: ObjectId, required: true },
  record: { type: ObjectId, required: true },
  user: { type: ObjectId, ref: 'User', required: true },
  reason: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  createdAt: { type: Date, default: Date.now },
});
followSchema.index({ user: 1, record: 1 }, { unique: true });
followSchema.index({ record: 1 });

export const Comment = mongoose.model('Comment', commentSchema);
export const Follow = mongoose.model('Follow', followSchema);

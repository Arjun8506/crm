import mongoose from 'mongoose';

// Distinct even for records created in the same millisecond (bulk inserts), so ordering is stable.
let rankSeq = 0;
const nextRank = () => Date.now() + (rankSeq++ % 1000) / 1000;

// Hybrid model: one `records` collection, values in a `data` sub-document keyed by field key.
// Field metadata is in FieldDefinition, so adding a custom field never needs a migration.
const recordSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    dataform: { type: mongoose.Schema.Types.ObjectId, ref: 'Dataform', required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Manual ordering (Kanban). Fractional so a card can be dropped between two others.
    rank: { type: Number, default: nextRank },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false },
);
recordSchema.index({ account: 1, dataform: 1, createdAt: -1 });
recordSchema.index({ account: 1, dataform: 1, updatedAt: -1 });
recordSchema.index({ account: 1, dataform: 1, rank: 1 });

const historySchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, required: true },
  dataform: { type: mongoose.Schema.Types.ObjectId, required: true },
  record: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['create', 'update', 'delete'], required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Set when the change was made by a workflow rather than directly by the user.
  workflow: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow' },
  // Where a change came from when it was not typed in by a person: 'import', 'form:<name>'.
  source: { type: String, maxlength: 80 },
  // Bounded per entry; one entry per save, so no unbounded array growth on the record itself.
  changes: { type: [{ _id: false, field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed }], default: [] },
  at: { type: Date, default: Date.now },
});
historySchema.index({ account: 1, record: 1, at: -1 });

export const RecordModel = mongoose.model('Record', recordSchema);
export const RecordHistory = mongoose.model('RecordHistory', historySchema);

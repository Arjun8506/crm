import mongoose from 'mongoose';

// Hybrid model: one `records` collection, values in a `data` sub-document keyed by field key.
// Field metadata is in FieldDefinition, so adding a custom field never needs a migration.
const recordSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    dataform: { type: mongoose.Schema.Types.ObjectId, ref: 'Dataform', required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false },
);
recordSchema.index({ account: 1, dataform: 1, createdAt: -1 });
recordSchema.index({ account: 1, dataform: 1, updatedAt: -1 });

const historySchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, required: true },
  dataform: { type: mongoose.Schema.Types.ObjectId, required: true },
  record: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['create', 'update', 'delete'], required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Bounded per entry; one entry per save, so no unbounded array growth on the record itself.
  changes: { type: [{ _id: false, field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed }], default: [] },
  at: { type: Date, default: Date.now },
});
historySchema.index({ account: 1, record: 1, at: -1 });

export const RecordModel = mongoose.model('Record', recordSchema);
export const RecordHistory = mongoose.model('RecordHistory', historySchema);

import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// One CSV import. The uploaded file is kept in storage until the job expires so it can be previewed, dry-run, run and resumed.
const importSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  workspace: { type: ObjectId, required: true },
  dataform: { type: ObjectId, required: true },
  user: { type: ObjectId, ref: 'User', required: true },
  filename: { type: String, maxlength: 200 },
  storageKey: { type: String, select: false },
  delimiter: String,
  headers: [String],
  sample: [[String]],
  rowCount: { type: Number, default: 0 },
  status: { type: String, enum: ['uploaded', 'queued', 'running', 'done', 'failed', 'cancelled'], default: 'uploaded' },
  dryRun: { type: Boolean, default: false },
  mapping: { type: [{ _id: false, column: Number, field: String }], default: [] },
  options: {
    duplicate: { type: String, enum: ['skip', 'update', 'error'], default: 'skip' },
    matchField: String,
    dateFormat: { type: String, enum: ['iso', 'dmy', 'mdy'], default: 'iso' },
  },
  processed: { type: Number, default: 0 },
  counts: { created: { type: Number, default: 0 }, updated: { type: Number, default: 0 }, skipped: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
  // First 1000 row errors; the downloadable errors file has the full original rows.
  errors: { type: [{ _id: false, row: Number, message: String }], default: [] },
  errorsKey: { type: String, select: false },
  hasErrorsFile: { type: Boolean, default: false },
  failure: String,
  startedAt: Date,
  finishedAt: Date,
  createdAt: { type: Date, default: Date.now, index: true },
}, { suppressReservedKeysWarning: true });
importSchema.index({ account: 1, dataform: 1, createdAt: -1 });

// One export. Runs in the background and leaves a file that is available for a few days.
const exportSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  workspace: { type: ObjectId, required: true },
  dataform: { type: ObjectId, required: true },
  user: { type: ObjectId, ref: 'User', required: true },
  format: { type: String, enum: ['csv', 'zip'], default: 'csv' },
  params: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued' },
  filename: String,
  storageKey: { type: String, select: false },
  rowCount: { type: Number, default: 0 },
  fileCount: { type: Number, default: 0 },
  size: { type: Number, default: 0 },
  warnings: { type: [String], default: [] },
  failure: String,
  finishedAt: Date,
  createdAt: { type: Date, default: Date.now, index: true },
});
exportSchema.index({ account: 1, dataform: 1, createdAt: -1 });

export const ImportJob = mongoose.model('ImportJob', importSchema);
export const ExportJob = mongoose.model('ExportJob', exportSchema);
export const IMPORT_KEEP_DAYS = 30;
export const EXPORT_KEEP_DAYS = 3;

import crypto from 'node:crypto';
import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// A public web form: anyone with the link can create a record in the dataform, but only through the fields listed here.
const formSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  workspace: { type: ObjectId, required: true },
  dataform: { type: ObjectId, required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: '', maxlength: 1000 },
  successMessage: { type: String, default: 'Thank you! Your response has been recorded.', maxlength: 500 },
  token: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  // The only fields a visitor can see or set, in display order.
  fields: { type: [{ _id: false, key: String, label: { type: String, maxlength: 80 }, helpText: { type: String, maxlength: 200 }, required: Boolean }], default: [] },
  allowFiles: { type: Boolean, default: false },
  opensAt: Date,
  closesAt: Date,
  maxSubmissions: { type: Number, min: 1, default: null },
  submissionCount: { type: Number, default: 0 },
  notifyUsers: { type: [ObjectId], default: [] },
  createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
formSchema.index({ account: 1, dataform: 1 });

// A read-only link to one record. Only the hash of the link is stored, so a database leak does not expose live links.
const shareSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  workspace: { type: ObjectId, required: true },
  dataform: { type: ObjectId, required: true },
  record: { type: ObjectId, required: true },
  tokenHash: { type: String, required: true, unique: true },
  hint: { type: String, maxlength: 12 },
  fields: { type: [String], default: [] },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  viewCount: { type: Number, default: 0 },
  lastViewedAt: Date,
  createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
shareSchema.index({ account: 1, record: 1 });
// Expired links are removed shortly after they stop working.
shareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });

export const PublicForm = mongoose.model('PublicForm', formSchema);
export const PublicShare = mongoose.model('PublicShare', shareSchema);

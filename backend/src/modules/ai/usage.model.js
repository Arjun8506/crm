import mongoose from 'mongoose';

// One document per account per calendar month (UTC): how many AI requests have been used against the plan.
const schema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, required: true },
  month: { type: String, required: true },
  requests: { type: Number, default: 0 },
  // Housekeeping: months older than a year are dropped.
  createdAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 400 * 86400 } },
});
schema.index({ account: 1, month: 1 }, { unique: true });

export const AiUsage = mongoose.model('AiUsage', schema);
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

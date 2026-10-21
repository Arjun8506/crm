import mongoose from 'mongoose';

// Durable background jobs stored in MongoDB. Chosen over Redis/BullMQ so the app has no extra infrastructure;
// jobs are claimed atomically, so several API instances can run workers safely. Swapping in BullMQ later only
// replaces queue.js: the handlers and payloads stay the same.
const jobSchema = new mongoose.Schema({
  type: { type: String, required: true, maxlength: 60 },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['queued', 'running', 'done', 'failed', 'cancelled'], default: 'queued' },
  runAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 4 },
  lockedUntil: Date,
  lastError: { type: String, maxlength: 1000 },
  // Enqueueing the same dedupeKey twice is a no-op, which makes producers safe to retry.
  dedupeKey: { type: String, maxlength: 200 },
  createdAt: { type: Date, default: Date.now },
  finishedAt: Date,
  expireAt: { type: Date, index: { expireAfterSeconds: 0 } },
});
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
jobSchema.index({ type: 1, 'payload.executionId': 1 }, { sparse: true });

export const Job = mongoose.model('Job', jobSchema);

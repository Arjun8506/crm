import { Job } from './job.model.js';

const LOCK_MS = 5 * 60_000;
const KEEP_MS = 7 * 864e5;
const handlers = new Map();

// handler(payload, { job }) may throw to trigger a retry. onFinalFailure(payload, error) runs once retries are exhausted.
export function registerHandler(type, handler, { onFinalFailure } = {}) {
  handlers.set(type, { handler, onFinalFailure });
}

export async function enqueue(type, payload, { runAt = new Date(), maxAttempts = 4, dedupeKey } = {}) {
  try {
    return await Job.create({ type, payload, runAt, maxAttempts, ...(dedupeKey ? { dedupeKey } : {}) });
  } catch (err) {
    if (err.code === 11000) return null; // already enqueued
    throw err;
  }
}

// Exponential backoff: 5s, 20s, 80s, ... capped at 30 minutes.
export const backoffMs = (attempt) => Math.min(5000 * 4 ** (attempt - 1), 30 * 60_000);

const claim = (now) => Job.findOneAndUpdate(
  { $or: [{ status: 'queued', runAt: { $lte: now } }, { status: 'running', lockedUntil: { $lt: now } }] },
  { $set: { status: 'running', lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
  { sort: { runAt: 1 }, returnDocument: 'after' },
);

export async function processOne(now = new Date()) {
  const job = await claim(now);
  if (!job) return false;
  const entry = handlers.get(job.type);
  const finish = (fields) => Job.updateOne({ _id: job._id }, { $set: { ...fields, lockedUntil: null, finishedAt: new Date(), expireAt: new Date(Date.now() + KEEP_MS) } });
  if (!entry) {
    await finish({ status: 'failed', lastError: `No handler registered for "${job.type}"` });
    return true;
  }
  try {
    await entry.handler(job.payload, { job });
    await finish({ status: 'done', lastError: null });
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 1000);
    if (job.attempts >= job.maxAttempts) {
      await finish({ status: 'failed', lastError: message });
      try { await entry.onFinalFailure?.(job.payload, err); } catch (e) { console.error(`[queue] onFinalFailure for ${job.type} failed:`, e.message); }
    } else {
      await Job.updateOne({ _id: job._id }, { $set: { status: 'queued', runAt: new Date(now.getTime() + backoffMs(job.attempts)), lockedUntil: null, lastError: message } });
    }
  }
  return true;
}

// Runs every job that is due right now (used by tests and by the worker loop).
export async function drain({ limit = 200, now = () => new Date() } = {}) {
  let n = 0;
  while (n < limit && (await processOne(now()))) n++;
  return n;
}

export const cancelJobs = (filter) => Job.updateMany({ ...filter, status: { $in: ['queued', 'running'] } }, { $set: { status: 'cancelled', finishedAt: new Date(), expireAt: new Date(Date.now() + KEEP_MS) } });

export function startWorker(intervalMs = 2000) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await drain({ limit: 50 }); } catch (err) { console.error('[queue] worker error:', err.message); } finally { busy = false; }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

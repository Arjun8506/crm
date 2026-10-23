import { notify } from '../modules/notifications/notification.service.js';
import { applyDuePlanChanges } from '../modules/billing/billing.service.js';
import { purgeExpiredJobs } from '../modules/imports/cleanup.js';
import { runDueWorkflows } from '../modules/workflows/engine.js';
import { Task } from '../modules/tasks/task.model.js';

// In-process scheduler for task reminders and due-date notifications. Each notification is *claimed* with an
// atomic findOneAndUpdate before it is sent, so several API instances can run this safely without duplicates.
// When the BullMQ/Redis queue arrives (Phase 5) this becomes a repeatable job; the function itself does not change.
const DAY = 864e5;
const BATCH = 500;

async function claimAndNotify(filter, claimField, now, build) {
  let sent = 0;
  for (let i = 0; i < BATCH; i++) {
    const task = await Task.findOneAndUpdate(filter, { $set: { [claimField]: now } }, { returnDocument: 'after' });
    if (!task) break;
    const recipients = task.assignees.length ? task.assignees : [task.createdBy];
    await notify({ account: task.account, recipients, type: build.type, title: build.title(task), body: build.body?.(task) ?? '', link: `/tasks?task=${task._id}` });
    sent++;
  }
  return sent;
}

export async function runScheduledNotifications(now = new Date()) {
  const open = { status: { $ne: 'done' } };
  const reminders = await claimAndNotify({ ...open, reminderAt: { $lte: now }, reminderSentAt: null }, 'reminderSentAt', now, { type: 'task_reminder', title: (t) => `Reminder: ${t.title}` });
  const overdue = await claimAndNotify({ ...open, due: { $lt: now }, overdueNotifiedAt: null }, 'overdueNotifiedAt', now, { type: 'task_overdue', title: (t) => `Overdue: ${t.title}` });
  const soon = await claimAndNotify(
    { ...open, due: { $gte: now, $lt: new Date(now.getTime() + DAY) }, dueSoonNotifiedAt: null }, 'dueSoonNotifiedAt', now,
    { type: 'task_due', title: (t) => `Due within 24 hours: ${t.title}`, body: (t) => `Due ${t.due.toISOString().slice(0, 16).replace('T', ' ')} UTC` },
  );
  return { reminders, overdue, soon };
}

export function startScheduler(intervalMs = 60_000) {
  const timer = setInterval(() => {
    runScheduledNotifications().catch((err) => console.error('[scheduler] run failed:', err.message));
    runDueWorkflows().catch((err) => console.error('[scheduler] workflow run failed:', err.message));
    applyDuePlanChanges().catch((err) => console.error('[scheduler] plan changes failed:', err.message));
    purgeExpiredJobs().catch((err) => console.error('[scheduler] cleanup failed:', err.message));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

import { LIMIT_LABELS, PLANS, isPlan, rank } from '../../config/plans.js';
import { providerByName } from '../../providers/payments/index.js';
import { Account } from '../accounts/account.model.js';
import { AiUsage, monthKey } from '../ai/usage.model.js';
import { ApiKey } from '../apikeys/apikey.model.js';
import { AuditLog } from '../audit/audit.js';
import { Attachment } from '../attachments/attachment.model.js';
import { notify } from '../notifications/notification.service.js';
import { OutboundWebhook } from '../outbound/webhook.model.js';
import { PublicForm } from '../publicforms/public.models.js';
import { RecordModel } from '../records/record.model.js';
import { Membership } from '../users/membership.model.js';
import { Workspace } from '../workspaces/workspace.model.js';
import { entitlementsOf } from './entitlements.js';
import { BillingEvent, CheckoutSession, Invoice, Subscription } from './billing.models.js';

const DAY = 864e5;

export async function usageOf(accountId) {
  const [workspaces, users, records, storage, ai] = await Promise.all([
    Workspace.countDocuments({ account: accountId }),
    Membership.countDocuments({ account: accountId, status: 'active' }),
    RecordModel.countDocuments({ account: accountId }),
    Attachment.aggregate([{ $match: { account: accountId } }, { $group: { _id: null, bytes: { $sum: '$size' } } }]),
    AiUsage.findOne({ account: accountId, month: monthKey() }).lean(),
  ]);
  return { workspaces, users, records, storageBytes: storage[0]?.bytes ?? 0, aiRequests: ai?.requests ?? 0 };
}

const MEASURED = { maxWorkspaces: 'workspaces', maxUsers: 'users', maxRecords: 'records', aiRequestsPerMonth: 'aiRequests' };

// Usage next to each limit, for the usage report.
export function meter(usage, entitlements) {
  return Object.entries(MEASURED).map(([limit, used]) => ({
    key: limit, label: LIMIT_LABELS[limit], used: usage[used], limit: entitlements[limit],
    percent: entitlements[limit] ? Math.min(100, Math.round((usage[used] / entitlements[limit]) * 100)) : (usage[used] > 0 ? 100 : 0),
  }));
}

// What moving to `target` would mean: things that stop it (current use above the new limit) and things that merely stop working.
export async function previewChange(account, targetId) {
  const current = account.plan;
  const direction = rank(targetId) > rank(current) ? 'upgrade' : rank(targetId) < rank(current) ? 'downgrade' : 'same';
  const next = { ...PLANS[targetId].limits, ...(account.entitlementOverrides ?? {}) };
  const usage = await usageOf(account._id);
  const blockers = [];
  for (const [limit, used] of Object.entries(MEASURED)) {
    if (limit === 'aiRequestsPerMonth') continue;
    if (usage[used] > next[limit]) blockers.push(`You have ${usage[used].toLocaleString('en-US')} ${LIMIT_LABELS[limit].toLowerCase()}; the ${PLANS[targetId].name} plan allows ${next[limit].toLocaleString('en-US')}. Remove some first.`);
  }
  const warnings = [];
  const now = entitlementsOf(account);
  if (direction === 'downgrade') {
    if (now.apiAccess && !next.apiAccess) {
      const [keys, hooks] = await Promise.all([ApiKey.countDocuments({ account: account._id, revokedAt: null }), OutboundWebhook.countDocuments({ account: account._id, enabled: true })]);
      if (keys || hooks) warnings.push(`${keys} API key${keys === 1 ? '' : 's'} and ${hooks} webhook${hooks === 1 ? '' : 's'} will stop working.`);
    }
    if (now.publicPages && !next.publicPages) {
      const forms = await PublicForm.countDocuments({ account: account._id });
      warnings.push(`Public forms${forms ? ` (${forms} existing)` : ''} and shared links will stop working.`);
    }
    if (now.aiRequestsPerMonth && !next.aiRequestsPerMonth) warnings.push('AI assistance will no longer be available.');
    if (now.locationFields && !next.locationFields) warnings.push('Existing location fields keep their data, but you cannot add new ones.');
    if (usage.storageBytes && next.maxUploadMb < now.maxUploadMb) warnings.push(`New files are limited to ${next.maxUploadMb} MB.`);
  }
  return { current, target: targetId, direction, blockers, warnings, effective: direction === 'downgrade' ? 'period_end' : 'now' };
}

const owners = (accountId) => Membership.find({ account: accountId, role: { $in: ['owner', 'admin'] }, status: 'active' }).distinct('user');
const tell = async (accountId, title, body) => notify({ account: accountId, recipients: await owners(accountId), type: 'billing', title, body, link: '/settings/billing' });
const log = (accountId, action, summary) => AuditLog.create({ account: accountId, action, targetType: 'billing', summary }).catch((e) => console.error('[audit] billing:', e.message));

// Applies one verified provider event. Safe to call twice with the same event id (the second call does nothing).
export async function processBillingEvent(provider, event) {
  if (!event?.type) return { handled: false };
  try {
    await BillingEvent.create({ provider, eventId: event.id, type: event.type });
  } catch (err) {
    if (err.code === 11000) return { handled: false, duplicate: true };
    throw err;
  }
  const d = event.data ?? {};

  if (event.type === 'checkout.failed') {
    await CheckoutSession.updateOne({ provider, providerSessionId: d.sessionId, status: 'pending' }, { $set: { status: 'failed' } });
    return { handled: true };
  }

  if (event.type === 'checkout.completed') {
    const session = await CheckoutSession.findOne({ provider, providerSessionId: d.sessionId });
    // A confirmation for a checkout we never started (or already finished) changes nothing.
    if (!session || session.status !== 'pending' || !isPlan(session.plan)) return { handled: false };
    const old = await Subscription.findOne({ account: session.account });
    await Subscription.findOneAndUpdate(
      { account: session.account },
      { $set: { plan: session.plan, status: 'active', provider, providerCustomerId: d.customerId, providerSubscriptionId: d.subscriptionId, currentPeriodEnd: d.periodEnd ? new Date(d.periodEnd) : undefined, cancelAtPeriodEnd: false, pendingPlan: null, startedAt: new Date(), canceledAt: null } },
      { upsert: true },
    );
    await Account.updateOne({ _id: session.account }, { $set: { plan: session.plan } });
    session.status = 'completed';
    await session.save();
    // Moving between paid plans replaces the old provider subscription so the customer is never billed twice.
    if (old?.providerSubscriptionId && old.providerSubscriptionId !== d.subscriptionId && old.status !== 'canceled') {
      await providerByName(old.provider)?.cancelSubscription({ providerSubscriptionId: old.providerSubscriptionId, atPeriodEnd: false }).catch((e) => console.error('[billing] could not cancel the replaced subscription:', e.message));
    }
    await log(session.account, 'billing.plan_changed', `Now on the ${PLANS[session.plan].name} plan`);
    await tell(session.account, `You are now on the ${PLANS[session.plan].name} plan`, 'Your new limits are active.');
    return { handled: true };
  }

  const sub = d.subscriptionId ? await Subscription.findOne({ provider, providerSubscriptionId: d.subscriptionId }) : null;
  if (!sub) return { handled: false };

  if (event.type === 'invoice.paid' || event.type === 'invoice.failed') {
    const paid = event.type === 'invoice.paid';
    await Invoice.updateOne(
      { provider, providerInvoiceId: d.invoiceId, status: paid ? 'paid' : 'failed' },
      { $setOnInsert: { account: sub.account, plan: sub.plan, amount: d.amount ?? 0, currency: d.currency ?? 'usd', number: d.number, hostedUrl: d.hostedUrl, periodStart: d.periodStart ? new Date(d.periodStart) : undefined, periodEnd: d.periodEnd ? new Date(d.periodEnd) : undefined } },
      { upsert: true },
    );
    if (paid) {
      if (d.periodEnd) sub.currentPeriodEnd = new Date(d.periodEnd);
      if (sub.status === 'past_due') sub.status = 'active';
      await sub.save();
    } else {
      sub.status = 'past_due';
      await sub.save();
      await tell(sub.account, 'A payment failed', 'Please update your payment method under Billing so your plan stays active.');
    }
    return { handled: true };
  }

  if (event.type === 'subscription.canceled') {
    const next = sub.pendingPlan && isPlan(sub.pendingPlan) ? sub.pendingPlan : 'free';
    sub.status = 'canceled';
    sub.canceledAt = new Date();
    await sub.save();
    await Account.updateOne({ _id: sub.account }, { $set: { plan: next } });
    await log(sub.account, 'billing.plan_changed', `Subscription ended; now on the ${PLANS[next].name} plan`);
    await tell(sub.account, `Your plan changed to ${PLANS[next].name}`, 'Your subscription has ended. Your data is kept; some features are now limited.');
    return { handled: true };
  }
  return { handled: false };
}

// Plan changes scheduled for the end of the paid period (downgrades and cancellations) take effect here.
export async function applyDuePlanChanges(now = new Date()) {
  const due = await Subscription.find({ status: { $in: ['active', 'past_due'] }, currentPeriodEnd: { $lte: now }, $or: [{ cancelAtPeriodEnd: true }, { pendingPlan: { $ne: null } }] }).limit(100);
  for (const sub of due) {
    const next = sub.pendingPlan && isPlan(sub.pendingPlan) ? sub.pendingPlan : 'free';
    if (sub.provider === 'test' && sub.providerSubscriptionId) await providerByName('test').cancelSubscription({ providerSubscriptionId: sub.providerSubscriptionId });
    sub.status = next === 'free' ? 'canceled' : 'active';
    sub.plan = next === 'free' ? sub.plan : next;
    sub.cancelAtPeriodEnd = false;
    sub.pendingPlan = null;
    if (next === 'free') sub.canceledAt = now;
    else sub.currentPeriodEnd = new Date(now.getTime() + 30 * DAY);
    await sub.save();
    await Account.updateOne({ _id: sub.account }, { $set: { plan: next } });
    await log(sub.account, 'billing.plan_changed', `Scheduled change applied: now on the ${PLANS[next].name} plan`);
    await tell(sub.account, `Your plan changed to ${PLANS[next].name}`, 'The change you scheduled has taken effect.');
  }
  return due.length;
}

import crypto from 'node:crypto';
import { BlockedUrlError, assertPublicUrl, request } from '../../providers/http.js';
import { AuditLog } from '../audit/audit.js';
import { featureEnabled } from '../billing/entitlements.js';
import { decrypt } from '../integrations/secrets.js';
import { notify } from '../notifications/notification.service.js';
import { enqueue, registerHandler } from '../queue/queue.js';
import { OutboundWebhook, WebhookDelivery } from './webhook.model.js';

// Outbound webhooks: signed, retried, never allowed to reach internal addresses.
// Producers call dispatchEvent(); delivery happens in the background queue.
const MAX_ATTEMPTS = 6;
const DISABLE_AFTER = 10;

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function sign(secret, timestamp, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

// Never throws: a webhook problem must not turn into an error for the person whose change caused the event.
export async function dispatchEvent({ account, event, dataformId, data, eventId = crypto.randomUUID(), only }) {
  try {
    // `only` re-sends one event to one webhook (redelivery) regardless of its current subscriptions.
    const hooks = only ? await OutboundWebhook.find({ _id: only, account }).lean() : await OutboundWebhook.find({ account, enabled: true, events: event }).lean();
    // Outbound webhooks are a plan feature: after a downgrade, existing hooks stay configured but stop sending.
    if (hooks.length && !(await featureEnabled(account, 'apiAccess'))) return;
    for (const hook of hooks) {
      if (!only && hook.dataforms.length && (!dataformId || !hook.dataforms.some((d) => String(d) === String(dataformId)))) continue;
      const payload = { id: eventId, event, createdAt: new Date().toISOString(), data };
      const delivery = await WebhookDelivery.create({ account, webhook: hook._id, event, eventId, payload });
      await enqueue('webhook.deliver', { deliveryId: String(delivery._id) }, { maxAttempts: MAX_ATTEMPTS, dedupeKey: `wh:${delivery._id}` });
    }
  } catch (err) {
    console.error('[webhooks] could not queue event:', err.message);
  }
}

// Record changes: one hook point, fed from triggerPostSave (which every record write path already calls).
export function dispatchRecordEvent({ dataform, fields, event, recordId, before, after, actorId, byWorkflow }) {
  const visible = fields.filter((f) => f.visibility.list).map((f) => f.key);
  const pick = (d) => (d ? Object.fromEntries(Object.entries(d).filter(([k]) => visible.includes(k))) : undefined);
  const changes = event === 'update'
    ? visible.filter((k) => !same(before?.[k], after?.[k])).map((k) => ({ field: k, from: before?.[k] ?? null, to: after?.[k] ?? null }))
    : undefined;
  return dispatchEvent({
    account: dataform.account, event: `record.${{ create: 'created', update: 'updated', delete: 'deleted' }[event]}`, dataformId: dataform._id,
    data: {
      dataformId: String(dataform._id), dataformName: dataform.name, workspaceId: String(dataform.workspace), recordId: String(recordId),
      record: pick(event === 'delete' ? before : after), ...(changes ? { changes } : {}), actor: byWorkflow ? { type: 'workflow' } : { id: actorId ? String(actorId) : null },
    },
  });
}

// One delivery attempt. Throws on a retryable problem (the queue retries with backoff); returns normally when done or when retrying cannot help.
export async function attempt(delivery, hook) {
  const body = JSON.stringify(delivery.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const url = await assertPublicUrl(hook.url);
  const res = await request(url.toString(), {
    method: 'POST', body,
    headers: {
      'Content-Type': 'application/json', 'User-Agent': 'OrgCRM-Webhook/1', 'X-OrgCRM-Event': delivery.event, 'X-OrgCRM-Delivery': delivery.eventId,
      'X-OrgCRM-Timestamp': timestamp, 'X-OrgCRM-Signature': sign(decrypt(hook.secret), timestamp, body),
    },
  });
  return res;
}

registerHandler('webhook.deliver', async ({ deliveryId }) => {
  const delivery = await WebhookDelivery.findById(deliveryId);
  if (!delivery || delivery.status !== 'queued') return;
  const hook = await OutboundWebhook.findById(delivery.webhook).select('+secret').lean();
  if (!hook || !hook.enabled) {
    await WebhookDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'failed', error: 'The webhook was switched off or deleted' } });
    return;
  }
  delivery.attempts += 1;
  let res;
  try {
    res = await attempt(delivery, hook);
  } catch (err) {
    delivery.error = String(err.message).slice(0, 500);
    await delivery.save();
    if (err instanceof BlockedUrlError) { // retrying cannot make an internal address public
      await WebhookDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'failed' } });
      await recordFailure(hook, delivery);
      return;
    }
    throw err;
  }
  delivery.responseStatus = res.status;
  if (res.status >= 200 && res.status < 300) {
    delivery.status = 'succeeded'; delivery.deliveredAt = new Date(); delivery.error = undefined;
    await delivery.save();
    await OutboundWebhook.updateOne({ _id: hook._id }, { $set: { failureCount: 0, lastDeliveryAt: new Date(), lastStatus: 'ok' } });
    return;
  }
  delivery.error = res.status >= 300 && res.status < 400 ? `The receiver redirected (${res.status}). Redirects are not followed` : `The receiver answered ${res.status}`;
  await delivery.save();
  throw new Error(delivery.error);
}, {
  onFinalFailure: async ({ deliveryId }) => {
    const delivery = await WebhookDelivery.findOneAndUpdate({ _id: deliveryId, status: 'queued' }, { $set: { status: 'failed' } }, { returnDocument: 'after' });
    if (!delivery) return;
    const hook = await OutboundWebhook.findById(delivery.webhook).lean();
    if (hook) await recordFailure(hook, delivery);
  },
});

// A webhook that keeps failing switches itself off, and its creator is told, rather than retrying forever.
async function recordFailure(hook, delivery) {
  const updated = await OutboundWebhook.findOneAndUpdate({ _id: hook._id }, { $inc: { failureCount: 1 }, $set: { lastDeliveryAt: new Date(), lastStatus: 'failed' } }, { returnDocument: 'after' });
  if (updated && updated.enabled && updated.failureCount >= DISABLE_AFTER) {
    const reason = `Switched off after ${DISABLE_AFTER} failed deliveries in a row. Last error: ${delivery.error ?? 'unknown'}`.slice(0, 200);
    await OutboundWebhook.updateOne({ _id: hook._id }, { $set: { enabled: false, disabledReason: reason } });
    await AuditLog.create({ account: hook.account, action: 'webhook.auto_disabled', targetType: 'webhook', targetId: String(hook._id), summary: `${hook.name}: ${reason}` }).catch(() => {});
    await notify({ account: hook.account, recipients: [hook.createdBy], type: 'workflow_failed', title: `Webhook "${hook.name}" was switched off`, body: reason, link: '/settings/developers' });
  }
}

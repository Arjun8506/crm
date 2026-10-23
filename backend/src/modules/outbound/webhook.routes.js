import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, humansOnly, requirePermission } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { BlockedUrlError, assertPublicUrl } from '../../providers/http.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { audit } from '../audit/audit.js';
import { requireFeature } from '../billing/entitlements.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { encrypt } from '../integrations/secrets.js';
import { attempt, dispatchEvent } from './events.js';
import { EVENTS, OutboundWebhook, WebhookDelivery } from './webhook.model.js';

const router = Router();
router.use(authenticate, humansOnly, requirePermission('account:update'));

const idParams = z.object({ id: objectId });
const fields = {
  name: z.string().trim().min(2).max(80), url: z.string().url().max(500),
  events: z.array(z.enum(EVENTS)).min(1, 'Choose at least one event'), dataformIds: z.array(objectId).max(50),
};

async function checkTargets(req, { url, dataformIds }) {
  if (url) {
    try { await assertPublicUrl(url); } catch (err) { if (err instanceof BlockedUrlError) throw badRequest(err.message, [{ path: 'url', message: err.message }]); throw err; }
  }
  const ids = [...new Set(dataformIds ?? [])];
  if (ids.length && (await Dataform.countDocuments({ _id: { $in: ids }, account: req.auth.accountId })) !== ids.length) throw badRequest('One of the dataforms does not exist');
  return ids;
}

const present = (h) => { const { secret: _s, ...rest } = h.toObject ? h.toObject() : h; return rest; };

router.get('/', async (req, res) => {
  res.json({ data: (await OutboundWebhook.find({ account: req.auth.accountId }).sort({ createdAt: -1 }).lean()).map(present), events: EVENTS });
});

router.post('/', validate({ body: z.object({ name: fields.name, url: fields.url, events: fields.events, dataformIds: fields.dataformIds.default([]) }) }), async (req, res) => {
  await requireFeature(req.auth.accountId, 'apiAccess', 'API keys and webhooks');
  const dataforms = await checkTargets(req, req.body);
  const secret = crypto.randomBytes(24).toString('hex');
  const hook = await OutboundWebhook.create({ account: req.auth.accountId, name: req.body.name, url: req.body.url, events: req.body.events, dataforms, secret: encrypt(secret), createdBy: req.auth.userId });
  await audit(req, 'webhook.created', { type: 'webhook', id: hook._id, summary: `${hook.name} → ${new URL(hook.url).host}` });
  res.status(201).json({ webhook: present(hook), secret });
});

router.patch(
  '/:id',
  validate({ params: idParams, body: z.object({ name: fields.name, url: fields.url, events: fields.events, dataformIds: fields.dataformIds, enabled: z.boolean() }).partial() }),
  async (req, res) => {
    const hook = await OutboundWebhook.findOne({ _id: req.params.id, account: req.auth.accountId });
    if (!hook) throw notFound('Webhook not found');
    const { dataformIds, enabled, ...rest } = req.body;
    if (enabled) await requireFeature(req.auth.accountId, 'apiAccess', 'API keys and webhooks');
    const ids = await checkTargets(req, { url: rest.url, dataformIds });
    Object.assign(hook, rest);
    if (dataformIds) hook.dataforms = ids;
    if (enabled !== undefined) { hook.enabled = enabled; if (enabled) { hook.failureCount = 0; hook.disabledReason = undefined; } }
    await hook.save();
    await audit(req, 'webhook.updated', { type: 'webhook', id: hook._id, summary: `${hook.name}${enabled === undefined ? '' : enabled ? ' (enabled)' : ' (disabled)'}` });
    res.json({ webhook: present(hook) });
  },
);

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const hook = await OutboundWebhook.findOneAndDelete({ _id: req.params.id, account: req.auth.accountId });
  if (!hook) throw notFound('Webhook not found');
  await audit(req, 'webhook.deleted', { type: 'webhook', id: hook._id, summary: hook.name });
  res.status(204).end();
});

router.post('/:id/rotate-secret', validate({ params: idParams }), async (req, res) => {
  const hook = await OutboundWebhook.findOne({ _id: req.params.id, account: req.auth.accountId }).select('+secret');
  if (!hook) throw notFound('Webhook not found');
  const secret = crypto.randomBytes(24).toString('hex');
  hook.secret = encrypt(secret);
  await hook.save();
  await audit(req, 'webhook.secret_rotated', { type: 'webhook', id: hook._id, summary: hook.name });
  res.json({ secret });
});

// Sends a real "ping" right now and reports exactly what the receiver answered.
router.post('/:id/test', validate({ params: idParams }), async (req, res) => {
  const hook = await OutboundWebhook.findOne({ _id: req.params.id, account: req.auth.accountId }).select('+secret').lean();
  if (!hook) throw notFound('Webhook not found');
  const eventId = crypto.randomUUID();
  const payload = { id: eventId, event: 'webhook.test', createdAt: new Date().toISOString(), data: { message: 'This is a test delivery from OrgCRM.' } };
  try {
    const r = await attempt({ payload, event: 'webhook.test', eventId }, hook);
    res.json({ ok: r.status >= 200 && r.status < 300, status: r.status, error: r.status >= 200 && r.status < 300 ? undefined : `The receiver answered ${r.status}` });
  } catch (err) {
    res.json({ ok: false, error: String(err.message).slice(0, 300) });
  }
});

router.get('/:id/deliveries', validate({ params: idParams, query: z.object({ status: z.enum(['queued', 'succeeded', 'failed']).optional(), page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }) }), async (req, res) => {
  const hook = await OutboundWebhook.findOne({ _id: req.params.id, account: req.auth.accountId }).select('_id').lean();
  if (!hook) throw notFound('Webhook not found');
  const q = { account: req.auth.accountId, webhook: hook._id, ...(req.query.status ? { status: req.query.status } : {}) };
  const { page, limit } = req.query;
  const [data, total] = await Promise.all([WebhookDelivery.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), WebhookDelivery.countDocuments(q)]);
  res.json({ data, total, page, limit });
});

router.post('/deliveries/:id/redeliver', validate({ params: idParams }), async (req, res) => {
  const old = await WebhookDelivery.findOne({ _id: req.params.id, account: req.auth.accountId }).lean();
  if (!old) throw notFound('Delivery not found');
  const hook = await OutboundWebhook.findById(old.webhook).select('events').lean();
  if (!hook) throw notFound('Webhook not found');
  // Same event id as the original, so a receiver that already processed it can recognise the repeat.
  await dispatchEvent({ account: old.account, event: old.event, data: old.payload.data, eventId: old.eventId, only: String(old.webhook) });
  res.status(202).json({ queued: true });
});

export default router;

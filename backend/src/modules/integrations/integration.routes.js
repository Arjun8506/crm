import crypto from 'node:crypto';
import { Router } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { postSlack, assertSlackUrl } from '../../providers/slack.js';
import { verifyCredentials } from '../../providers/twilio.js';
import { Integration, KINDS } from './integration.model.js';
import { channelStatus } from './integration.service.js';
import { decrypt, encrypt, mask } from './secrets.js';

const router = Router();
router.use(authenticate);

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +14155550123');
const KIND_SCHEMAS = {
  slack: {
    secrets: z.object({ webhookUrl: z.string().url().refine((u) => { try { assertSlackUrl(u); return true; } catch { return false; } }, 'Use an incoming-webhook URL from Slack (https://hooks.slack.com/services/...)') }),
    settings: z.object({ label: z.string().trim().max(60).optional() }),
  },
  twilio: {
    secrets: z.object({ accountSid: z.string().regex(/^AC[a-fA-F0-9]{32}$/, 'The Account SID starts with AC and has 34 characters'), authToken: z.string().min(16).max(64) }),
    settings: z.object({ smsFrom: e164.optional(), whatsappFrom: e164.optional() }),
  },
  smtp: {
    secrets: z.object({ url: z.string().regex(/^smtps?:\/\/.+/, 'Use a URL like smtps://user:password@smtp.example.com:465') }),
    settings: z.object({ from: z.string().trim().min(3).max(200).optional() }),
  },
};
const kindParams = z.object({ kind: z.enum(KINDS) });

const webhooksFor = (doc) => {
  const base = `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/webhooks`;
  if (doc.kind === 'twilio') return { status: `${base}/twilio/status/${doc._id}`, inbound: `${base}/twilio/inbound/${doc._id}` };
  if (doc.kind === 'smtp') return { inboundEmail: `${base}/inbound-email/${doc._id}` };
  return {};
};

function present(doc, secrets) {
  return {
    id: doc._id, kind: doc.kind, enabled: doc.enabled, settings: doc.settings, status: doc.status, updatedAt: doc.updatedAt,
    secrets: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, mask(v)])),
    webhooks: webhooksFor(doc),
  };
}

router.get('/', requirePermission('account:update'), async (req, res) => {
  const docs = await Integration.find({ account: req.auth.accountId }).select('+secrets').lean();
  res.json({ data: docs.map((d) => present(d, decrypt(d.secrets))), channels: await channelStatus(req.auth.accountId) });
});

router.put(
  '/:kind',
  requirePermission('account:update'),
  validate({ params: kindParams, body: z.object({ enabled: z.boolean().optional(), secrets: z.record(z.string(), z.string()).optional(), settings: z.record(z.string(), z.string()).optional() }) }),
  async (req, res) => {
    const { kind } = req.params;
    const existing = await Integration.findOne({ account: req.auth.accountId, kind }).select('+secrets +webhookSecret');
    const current = existing ? decrypt(existing.secrets) : {};
    // Omitted secrets keep their stored value, so the form never has to re-send a credential.
    const secrets = { ...current, ...Object.fromEntries(Object.entries(req.body.secrets ?? {}).filter(([, v]) => v !== '')) };
    const sParsed = KIND_SCHEMAS[kind].secrets.safeParse(secrets);
    const tParsed = KIND_SCHEMAS[kind].settings.safeParse(Object.fromEntries(Object.entries({ ...(existing?.settings ?? {}), ...(req.body.settings ?? {}) }).filter(([, v]) => v !== '')));
    const issues = [...(sParsed.error?.issues ?? []).map((i) => ({ path: `secrets.${i.path.join('.')}`, message: i.message })), ...(tParsed.error?.issues ?? []).map((i) => ({ path: `settings.${i.path.join('.')}`, message: i.message }))];
    if (kind === 'twilio' && tParsed.success && !tParsed.data.smsFrom && !tParsed.data.whatsappFrom) issues.push({ path: 'settings.smsFrom', message: 'Enter an SMS and/or a WhatsApp sender number' });
    if (issues.length) throw badRequest('Validation failed', issues);

    const doc = existing ?? new Integration({ account: req.auth.accountId, kind, createdBy: req.auth.userId });
    doc.secrets = encrypt(sParsed.data);
    doc.settings = tParsed.data;
    if (req.body.enabled !== undefined) doc.enabled = req.body.enabled;
    const firstTime = !existing;
    if (firstTime || !existing.webhookSecret) doc.webhookSecret = encrypt(crypto.randomBytes(24).toString('hex'));
    doc.status = {}; // a changed configuration has not been tested yet
    await doc.save();
    const out = present(doc, sParsed.data);
    res.status(firstTime ? 201 : 200).json({ integration: out, ...(firstTime && kind === 'smtp' ? { webhookSecret: decrypt(doc.webhookSecret) } : {}) });
  },
);

router.delete('/:kind', requirePermission('account:update'), validate({ params: kindParams }), async (req, res) => {
  const r = await Integration.deleteOne({ account: req.auth.accountId, kind: req.params.kind });
  if (!r.deletedCount) throw notFound('That integration is not connected');
  res.status(204).end();
});

// Sends a real request to the provider. The result is stored and shown, never assumed.
router.post('/:kind/test', requirePermission('account:update'), validate({ params: kindParams }), async (req, res) => {
  const doc = await Integration.findOne({ account: req.auth.accountId, kind: req.params.kind }).select('+secrets');
  if (!doc) throw notFound('Connect the integration first');
  const secrets = decrypt(doc.secrets);
  let ok = true; let error; let detail;
  try {
    if (doc.kind === 'slack') await postSlack(secrets.webhookUrl, `Test message from OrgCRM, sent by ${req.auth.userId ? 'an administrator' : 'the system'}.`);
    else if (doc.kind === 'twilio') detail = `Connected to Twilio account "${await verifyCredentials(secrets)}"`;
    else {
      const transport = nodemailer.createTransport(secrets.url);
      await transport.verify();
      detail = 'The SMTP server accepted the connection and credentials';
    }
  } catch (err) {
    ok = false; error = String(err.message).slice(0, 400);
  }
  doc.status = { lastTestAt: new Date(), ok, ...(error ? { error } : {}) };
  await doc.save();
  res.json({ ok, error, detail });
});

router.post('/:kind/rotate-secret', requirePermission('account:update'), validate({ params: kindParams }), async (req, res) => {
  const doc = await Integration.findOne({ account: req.auth.accountId, kind: req.params.kind }).select('+webhookSecret');
  if (!doc) throw notFound('Connect the integration first');
  const secret = crypto.randomBytes(24).toString('hex');
  doc.webhookSecret = encrypt(secret);
  await doc.save();
  res.json({ webhookSecret: secret });
});

export default router;

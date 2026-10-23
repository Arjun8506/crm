import crypto from 'node:crypto';
import { env } from '../../config/env.js';

// A stand-in payment provider for development and automated tests. No money moves and no card is ever involved.
// It behaves like a real provider in the one way that matters: a checkout only becomes a subscription when a
// SIGNED event arrives at the webhook endpoint. The "complete checkout" button in the UI is what produces that event.

const secret = () => env.BILLING_WEBHOOK_SECRET ?? crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update('billing-test-provider').digest('hex');
const sign = (raw) => `sha256=${crypto.createHmac('sha256', secret()).update(raw).digest('hex')}`;

export const testProvider = {
  name: 'test',
  mode: 'test',
  configured: () => true,

  async createCheckout({ account, plan }) {
    const sessionId = `tcs_${crypto.randomBytes(12).toString('hex')}`;
    return { sessionId, url: `${env.APP_URL.replace(/\/$/, '')}/billing/test-checkout/${sessionId}`, accountId: String(account._id), plan };
  },
  async cancelSubscription() { return { ok: true }; },
  async resumeSubscription() { return { ok: true }; },

  // Builds the body and signature header the way a provider would. Only the test checkout endpoint calls this.
  signedEvent(type, data) {
    const raw = Buffer.from(JSON.stringify({ id: `evt_test_${crypto.randomUUID()}`, type, data }));
    return { raw, headers: { 'x-test-signature': sign(raw) } };
  },

  verifyWebhook(raw, headers) {
    const given = String(headers['x-test-signature'] ?? '');
    const want = sign(raw);
    if (given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) return null;
    const body = JSON.parse(raw.toString('utf8'));
    return { id: body.id, type: body.type, data: body.data };
  },
};

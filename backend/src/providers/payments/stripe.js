import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { request } from '../http.js';

// Stripe adapter over the plain HTTPS API (no SDK, so nothing to install). Card details are entered on Stripe's own
// hosted checkout page: they never reach this server. Needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and one price id per paid plan.
// Written against Stripe's documented API and covered by tests with a fake network. It has NOT been run against a live Stripe account.

const API = 'https://api.stripe.com/v1';
const TOLERANCE_S = 300;
const priceFor = (plan) => ({ team: env.STRIPE_PRICE_TEAM, business: env.STRIPE_PRICE_BUSINESS })[plan];

const form = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
  const key = prefix ? `${prefix}[${k}]` : k;
  if (v && typeof v === 'object') return form(v, key);
  return v === undefined || v === null ? [] : [`${encodeURIComponent(key)}=${encodeURIComponent(v)}`];
}).join('&');

async function call(method, path, body) {
  const res = await request(`${API}${path}`, {
    method, timeoutMs: 15_000,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    ...(body ? { body: form(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe answered ${res.status}`);
  return json;
}

const lineOf = (invoice) => invoice.lines?.data?.[0]?.period ?? {};
const at = (s) => (s ? new Date(s * 1000).toISOString() : undefined);

export const stripeProvider = {
  name: 'stripe',
  get mode() { return env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test'; },
  configured: () => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_TEAM && env.STRIPE_PRICE_BUSINESS),

  async createCheckout({ account, plan, successUrl, cancelUrl, email }) {
    const price = priceFor(plan);
    if (!price) throw new Error(`No Stripe price is configured for the ${plan} plan`);
    const session = await call('POST', '/checkout/sessions', {
      mode: 'subscription', client_reference_id: String(account._id), customer_email: email,
      line_items: { 0: { price, quantity: 1 } }, success_url: successUrl, cancel_url: cancelUrl,
      metadata: { account: String(account._id), plan }, subscription_data: { metadata: { account: String(account._id), plan } },
    });
    return { sessionId: session.id, url: session.url };
  },

  async cancelSubscription({ providerSubscriptionId, atPeriodEnd = true }) {
    if (atPeriodEnd) return call('POST', `/subscriptions/${providerSubscriptionId}`, { cancel_at_period_end: 'true' });
    return call('DELETE', `/subscriptions/${providerSubscriptionId}`);
  },
  resumeSubscription: ({ providerSubscriptionId }) => call('POST', `/subscriptions/${providerSubscriptionId}`, { cancel_at_period_end: 'false' }),

  // Returns a normalised event, `{ type: null }` for events we do not use, or null when the signature is wrong.
  verifyWebhook(raw, headers) {
    const parts = Object.fromEntries(String(headers['stripe-signature'] ?? '').split(',').map((p) => p.split('=')));
    const t = Number(parts.t);
    if (!env.STRIPE_WEBHOOK_SECRET || !Number.isFinite(t) || !parts.v1 || Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) return null;
    const want = crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw.toString('utf8')}`).digest('hex');
    if (parts.v1.length !== want.length || !crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(want))) return null;

    const event = JSON.parse(raw.toString('utf8'));
    const o = event.data?.object ?? {};
    switch (event.type) {
      case 'checkout.session.completed':
        if (o.payment_status !== 'paid' && o.payment_status !== 'no_payment_required') return { id: event.id, type: null };
        return { id: event.id, type: 'checkout.completed', data: { sessionId: o.id, subscriptionId: o.subscription, customerId: o.customer, accountId: o.client_reference_id, plan: o.metadata?.plan } };
      case 'checkout.session.expired':
        return { id: event.id, type: 'checkout.failed', data: { sessionId: o.id } };
      case 'invoice.paid':
        return { id: event.id, type: 'invoice.paid', data: { invoiceId: o.id, subscriptionId: o.subscription, amount: o.amount_paid, currency: o.currency, number: o.number, hostedUrl: o.hosted_invoice_url, periodStart: at(lineOf(o).start), periodEnd: at(lineOf(o).end) } };
      case 'invoice.payment_failed':
        return { id: event.id, type: 'invoice.failed', data: { invoiceId: o.id, subscriptionId: o.subscription, amount: o.amount_due, currency: o.currency, number: o.number, hostedUrl: o.hosted_invoice_url } };
      case 'customer.subscription.deleted':
        return { id: event.id, type: 'subscription.canceled', data: { subscriptionId: o.id } };
      default:
        return { id: event.id, type: null };
    }
  },
};

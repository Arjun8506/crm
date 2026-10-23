import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { LIMIT_LABELS, PLANS, PLAN_ORDER, rank } from '../../config/plans.js';
import { authenticate, humansOnly, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { activeProvider, providerByName } from '../../providers/payments/index.js';
import { ApiError, badRequest, conflict, notFound } from '../../utils/errors.js';
import { Account } from '../accounts/account.model.js';
import { audit } from '../audit/audit.js';
import { User } from '../users/user.model.js';
import { CheckoutSession, Invoice, Subscription } from './billing.models.js';
import { meter, previewChange, processBillingEvent, usageOf } from './billing.service.js';
import { entitlementsOf } from './entitlements.js';

const router = Router();
router.use(authenticate);

const publicPlan = (p) => ({ id: p.id, name: p.name, priceMonthly: p.priceMonthly, blurb: p.blurb, limits: p.limits });
const providerInfo = () => { const p = activeProvider(); return { name: p?.name ?? null, mode: p?.mode ?? null, configured: !!p?.configured() }; };
const planBody = z.object({ plan: z.enum(PLAN_ORDER) });

router.get('/plans', requirePermission('account:read'), async (req, res) => {
  const account = await Account.findById(req.auth.accountId).lean();
  res.json({ plans: PLAN_ORDER.map((id) => publicPlan(PLANS[id])), current: account.plan, labels: LIMIT_LABELS });
});

router.get('/overview', requirePermission('account:read'), async (req, res) => {
  const account = await Account.findById(req.auth.accountId).lean();
  const [subscription, usage, invoices] = await Promise.all([
    Subscription.findOne({ account: account._id }).lean(),
    usageOf(account._id),
    Invoice.find({ account: account._id }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  const entitlements = entitlementsOf(account);
  res.json({
    plan: publicPlan(PLANS[account.plan] ?? PLANS.free), entitlements, usage: { ...usage, meters: meter(usage, entitlements) },
    subscription: subscription ? { status: subscription.status, plan: subscription.plan, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, pendingPlan: subscription.pendingPlan, provider: subscription.provider } : null,
    provider: providerInfo(), invoices,
  });
});

router.get('/change-preview', requirePermission('account:update'), validate({ query: planBody }), async (req, res) => {
  const account = await Account.findById(req.auth.accountId).lean();
  res.json(await previewChange(account, req.query.plan));
});

// Starts a paid checkout. Nothing changes until the provider confirms it by webhook.
router.post('/checkout', humansOnly, requirePermission('account:update'), validate({ body: planBody }), async (req, res) => {
  const provider = activeProvider();
  if (!provider || !provider.configured()) throw new ApiError(409, 'NOT_CONFIGURED', 'Billing is not set up on this server, so plans cannot be purchased here.');
  const account = await Account.findById(req.auth.accountId).lean();
  const target = req.body.plan;
  if (target === 'free') throw badRequest('Choose "Change plan" to move to the Free plan');
  if (rank(target) <= rank(account.plan)) throw badRequest('Use "Change plan" to move to a lower plan');
  const user = await User.findById(req.auth.userId).select('email').lean();
  const base = env.APP_URL.replace(/\/$/, '');
  let session;
  try {
    session = await provider.createCheckout({ account, plan: target, email: user?.email, successUrl: `${base}/settings/billing?checkout=success`, cancelUrl: `${base}/settings/billing?checkout=cancelled` });
  } catch (err) {
    console.error('[billing] checkout failed:', err.message);
    throw new ApiError(502, 'PROVIDER_ERROR', 'The payment provider could not start the checkout. Please try again.');
  }
  await CheckoutSession.create({ account: account._id, user: req.auth.userId, plan: target, provider: provider.name, providerSessionId: session.sessionId });
  await audit(req, 'billing.checkout_started', { type: 'billing', summary: `${PLANS[target].name} plan` });
  res.status(201).json({ sessionId: session.sessionId, url: session.url });
});

router.get('/checkout/:sessionId', requirePermission('account:update'), async (req, res) => {
  const s = await CheckoutSession.findOne({ providerSessionId: req.params.sessionId, account: req.auth.accountId }).lean();
  if (!s) throw notFound('Checkout not found');
  res.json({ status: s.status, plan: s.plan, provider: s.provider });
});

// Downgrade, cancel, or switch to the free plan. Takes effect at the end of the paid period.
router.post('/change-plan', humansOnly, requirePermission('account:update'), validate({ body: z.object({ plan: z.enum(PLAN_ORDER), confirm: z.literal(true) }) }), async (req, res) => {
  const account = await Account.findById(req.auth.accountId).lean();
  const target = req.body.plan;
  if (rank(target) >= rank(account.plan)) throw badRequest(target === account.plan ? 'You are already on this plan' : 'Use checkout to upgrade');
  const sub = await Subscription.findOne({ account: account._id });
  if (!sub || sub.status === 'canceled') throw conflict('There is no active subscription to change');
  const preview = await previewChange(account, target);
  if (preview.blockers.length) throw new ApiError(409, 'DOWNGRADE_BLOCKED', preview.blockers[0], preview.blockers.map((m) => ({ path: 'plan', message: m })));
  const provider = providerByName(sub.provider);
  if (target !== 'free' && sub.provider !== 'test') throw new ApiError(409, 'NOT_SUPPORTED', `Moving between paid plans is not supported with ${sub.provider}. Cancel to the Free plan at the end of the period, then choose the new plan.`);
  if (target === 'free' && sub.providerSubscriptionId) {
    try { await provider.cancelSubscription({ providerSubscriptionId: sub.providerSubscriptionId, atPeriodEnd: true }); } catch (err) {
      console.error('[billing] cancel failed:', err.message);
      throw new ApiError(502, 'PROVIDER_ERROR', 'The payment provider could not schedule the change. Nothing was changed.');
    }
  }
  sub.cancelAtPeriodEnd = target === 'free';
  sub.pendingPlan = target === 'free' ? null : target;
  await sub.save();
  await audit(req, 'billing.change_scheduled', { type: 'billing', summary: `${PLANS[account.plan].name} → ${PLANS[target].name} at period end` });
  res.json({ subscription: { cancelAtPeriodEnd: sub.cancelAtPeriodEnd, pendingPlan: sub.pendingPlan, currentPeriodEnd: sub.currentPeriodEnd }, preview });
});

router.post('/resume', humansOnly, requirePermission('account:update'), async (req, res) => {
  const sub = await Subscription.findOne({ account: req.auth.accountId });
  if (!sub || sub.status === 'canceled' || (!sub.cancelAtPeriodEnd && !sub.pendingPlan)) throw conflict('There is no scheduled change to undo');
  if (sub.cancelAtPeriodEnd && sub.providerSubscriptionId) {
    try { await providerByName(sub.provider).resumeSubscription({ providerSubscriptionId: sub.providerSubscriptionId }); } catch (err) {
      console.error('[billing] resume failed:', err.message);
      throw new ApiError(502, 'PROVIDER_ERROR', 'The payment provider could not undo the cancellation. Nothing was changed.');
    }
  }
  sub.cancelAtPeriodEnd = false;
  sub.pendingPlan = null;
  await sub.save();
  await audit(req, 'billing.change_undone', { type: 'billing', summary: 'Scheduled change cancelled' });
  res.json({ ok: true });
});

router.get('/invoices', requirePermission('account:update'), async (req, res) => {
  res.json({ data: await Invoice.find({ account: req.auth.accountId }).sort({ createdAt: -1 }).limit(100).lean() });
});

// Development only: plays the part of the payment page. It does not change the plan itself: it sends the same signed
// event a real provider would, through the same webhook handler.
router.post('/test-checkout/:sessionId/complete', humansOnly, requirePermission('account:update'), validate({ body: z.object({ outcome: z.enum(['succeeded', 'failed']) }) }), async (req, res) => {
  const provider = activeProvider();
  if (provider?.name !== 'test') throw notFound('Not found');
  const session = await CheckoutSession.findOne({ providerSessionId: req.params.sessionId, account: req.auth.accountId, provider: 'test' });
  if (!session) throw notFound('Checkout not found');
  if (session.status !== 'pending') throw conflict('This checkout has already finished');
  const id = session.providerSessionId;
  const sent = [];
  if (req.body.outcome === 'failed') sent.push(provider.signedEvent('checkout.failed', { sessionId: id }));
  else {
    const subId = `sub_test_${id.slice(4)}`;
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString();
    sent.push(provider.signedEvent('checkout.completed', { sessionId: id, subscriptionId: subId, customerId: `cus_test_${req.auth.accountId}`, periodEnd }));
    sent.push(provider.signedEvent('invoice.paid', { invoiceId: `in_test_${id.slice(4)}`, subscriptionId: subId, amount: PLANS[session.plan].priceMonthly, currency: 'usd', number: `TEST-${id.slice(4, 10).toUpperCase()}`, periodStart: new Date().toISOString(), periodEnd }));
  }
  for (const { raw, headers } of sent) await processBillingEvent('test', provider.verifyWebhook(raw, headers));
  res.json({ status: (await CheckoutSession.findById(session._id).lean()).status });
});

export default router;

// ---- provider webhooks: mounted BEFORE the JSON body parser, because the signature covers the exact raw bytes ----
export const billingWebhookRouter = Router();
billingWebhookRouter.post('/:provider', async (req, res) => {
  const provider = providerByName(req.params.provider);
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!provider || provider !== activeProvider() || !raw.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  let event;
  try { event = provider.verifyWebhook(raw, req.headers); } catch { event = null; }
  if (!event) return res.status(400).json({ error: { code: 'BAD_SIGNATURE', message: 'Signature verification failed' } });
  try {
    await processBillingEvent(provider.name, event);
  } catch (err) {
    // A 5xx makes the provider retry, which is what we want for a transient failure.
    console.error('[billing] event processing failed:', err.message);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Could not process the event' } });
  }
  return res.json({ received: true });
});

import './_env.js';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let mongod; let app; let env; let Account; let Subscription; let Invoice; let CheckoutSession; let RecordModel; let drain;
let applyDuePlanChanges; let stripeProvider; let testProvider; let setFetch; let processBillingEvent;
const tokens = {};
const OWNER = 'owner@acme.test'; const MEMBER = 'member@acme.test'; const GLOBEX = 'owner@globex.test'; const GLOBEX_MEMBER = 'member@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};
const globex = () => Account.findOne({ name: /globex/i });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  ({ env } = await import('../src/config/env.js'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ Account } = await import('../src/modules/accounts/account.model.js'));
  ({ Subscription, Invoice, CheckoutSession } = await import('../src/modules/billing/billing.models.js'));
  ({ RecordModel } = await import('../src/modules/records/record.model.js'));
  ({ drain } = await import('../src/modules/queue/queue.js'));
  ({ applyDuePlanChanges, processBillingEvent } = await import('../src/modules/billing/billing.service.js'));
  ({ stripeProvider } = await import('../src/providers/payments/stripe.js'));
  ({ testProvider } = await import('../src/providers/payments/test.js'));
  ({ setFetch } = await import('../src/providers/http.js'));
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
  for (const who of [OWNER, MEMBER, GLOBEX, GLOBEX_MEMBER]) tokens[who] = (await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' })).body.accessToken;
});

after(async () => {
  setFetch(undefined);
  await mongoose.disconnect();
  await mongod.stop();
});

describe('plans and usage', () => {
  it('lists the plans and what each includes', async () => {
    const res = await api('get', MEMBER, '/billing/plans');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.plans.map((p) => p.id), ['free', 'team', 'business']);
    assert.equal(res.body.plans[0].priceMonthly, 0);
    assert.ok(res.body.plans[1].limits.apiAccess && !res.body.plans[0].limits.apiAccess);
    assert.equal(res.body.current, 'team');
    assert.equal((await request(app).get('/api/v1/billing/plans')).status, 401);
  });

  it('reports live usage next to each limit', async () => {
    const res = await api('get', MEMBER, '/billing/overview');
    assert.equal(res.status, 200);
    assert.equal(res.body.plan.id, 'team');
    assert.equal(res.body.subscription, null, 'the seeded account has no paid subscription');
    const meters = Object.fromEntries(res.body.usage.meters.map((m) => [m.key, m]));
    assert.equal(meters.maxWorkspaces.limit, 15);
    assert.ok(meters.maxWorkspaces.used >= 1);
    assert.equal(meters.maxUsers.used, 5);
    assert.equal(meters.maxRecords.used, await RecordModel.countDocuments({ account: (await Account.findOne({ plan: 'team' }))._id }));
    assert.equal(meters.aiRequestsPerMonth.limit, 200);
    assert.equal(res.body.provider.name, 'test');
    assert.equal(res.body.provider.mode, 'test');
  });

  it('keeps billing management to owners and admins signed in as people', async () => {
    assert.equal((await api('post', MEMBER, '/billing/checkout', { plan: 'business' })).status, 403);
    assert.equal((await api('get', MEMBER, '/billing/invoices')).status, 403);
    assert.equal((await api('get', MEMBER, '/billing/change-preview?plan=free')).status, 403);
    const key = await request(app).get('/api/v1/billing/overview').set({ Authorization: 'Bearer ocrm_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG' });
    assert.equal(key.status, 401, 'API keys never reach billing');
  });
});

describe('upgrading', () => {
  let sessionId;
  const status = async (id) => (await api('get', GLOBEX, `/billing/checkout/${id}`)).body.status;

  it('starts a checkout without changing the plan', async () => {
    const res = await api('post', GLOBEX, '/billing/checkout', { plan: 'team' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    sessionId = res.body.sessionId;
    assert.match(res.body.url, new RegExp(`/billing/test-checkout/${sessionId}$`));
    assert.equal(await status(sessionId), 'pending');
    assert.equal((await globex()).plan, 'free', 'a plan is never granted by starting a checkout');
    assert.equal((await api('post', GLOBEX, '/billing/checkout', { plan: 'free' })).status, 400);
    assert.equal((await api('post', GLOBEX, '/billing/checkout', { plan: 'enterprise' })).status, 400);
  });

  it('does not grant the plan if the payment fails', async () => {
    const res = await api('post', GLOBEX, `/billing/test-checkout/${sessionId}/complete`, { outcome: 'failed' });
    assert.equal(res.body.status, 'failed');
    assert.equal((await globex()).plan, 'free');
    assert.equal(await Subscription.countDocuments({ account: (await globex())._id }), 0);
    assert.equal((await api('post', GLOBEX, `/billing/test-checkout/${sessionId}/complete`, { outcome: 'succeeded' })).status, 409, 'a finished checkout cannot be replayed');
  });

  it('ignores forged or replayed provider messages', async () => {
    const started = (await api('post', GLOBEX, '/billing/checkout', { plan: 'business' })).body;
    const forged = Buffer.from(JSON.stringify({ id: 'evt_x', type: 'checkout.completed', data: { sessionId: started.sessionId, subscriptionId: 'sub_evil' } }));
    const post = (raw, headers = {}) => request(app).post('/api/v1/webhooks/billing/test').set({ 'Content-Type': 'application/octet-stream', ...headers }).send(raw);
    assert.equal((await post(forged)).status, 400, 'unsigned');
    assert.equal((await post(forged, { 'x-test-signature': 'sha256=deadbeef' })).status, 400, 'wrong signature');
    assert.equal((await post(Buffer.from(''))).status, 404);
    assert.equal((await request(app).post('/api/v1/webhooks/billing/stripe').send(forged)).status, 404, 'a provider that is not in use');
    assert.equal((await globex()).plan, 'free');

    const real = testProvider.signedEvent('checkout.completed', { sessionId: 'tcs_never_started', subscriptionId: 'sub_x' });
    assert.equal((await post(real.raw, real.headers)).status, 200);
    assert.equal(await Subscription.countDocuments({ providerSubscriptionId: 'sub_x' }), 0, 'a signed message about a checkout we never started changes nothing');
    await api('post', GLOBEX, `/billing/test-checkout/${started.sessionId}/complete`, { outcome: 'failed' });
  });

  it('only the account that started a checkout can finish it', async () => {
    const started = (await api('post', GLOBEX, '/billing/checkout', { plan: 'team' })).body;
    assert.equal((await api('post', OWNER, `/billing/test-checkout/${started.sessionId}/complete`, { outcome: 'succeeded' })).status, 404);
    assert.equal((await api('get', OWNER, `/billing/checkout/${started.sessionId}`)).status, 404);
    sessionId = started.sessionId;
  });

  it('grants the plan, a subscription and an invoice once the provider confirms', async () => {
    const res = await api('post', GLOBEX, `/billing/test-checkout/${sessionId}/complete`, { outcome: 'succeeded' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'completed');
    const acct = await globex();
    assert.equal(acct.plan, 'team');
    const sub = await Subscription.findOne({ account: acct._id });
    assert.equal(sub.status, 'active');
    assert.equal(sub.cancelAtPeriodEnd, false);
    assert.ok(sub.currentPeriodEnd > new Date());
    const invoices = (await api('get', GLOBEX, '/billing/invoices')).body.data;
    assert.equal(invoices.length, 1);
    assert.deepEqual([invoices[0].status, invoices[0].amount, invoices[0].plan], ['paid', 2900, 'team']);
    const overview = (await api('get', GLOBEX, '/billing/overview')).body;
    assert.equal(overview.plan.id, 'team');
    assert.equal(overview.subscription.status, 'active');
    assert.equal(overview.invoices.length, 1);
    const note = (await api('get', GLOBEX, '/notifications?limit=10')).body.data.find((n) => n.type === 'billing');
    assert.match(note.title, /now on the Team plan/);
    assert.equal((await api('get', GLOBEX_MEMBER, '/billing/invoices')).status, 403);
    assert.equal((await api('get', OWNER, '/billing/invoices')).body.data.length, 0, 'invoices are per account');
  });

  it('the new plan unlocks its features', async () => {
    assert.equal((await api('post', GLOBEX, '/api-keys', { name: 'Now allowed', scope: 'read' })).status, 201);
  });

  it('handles a delivered-twice event only once', async () => {
    const acct = await globex();
    const before = await Invoice.countDocuments({ account: acct._id });
    const sub = await Subscription.findOne({ account: acct._id });
    const e = testProvider.signedEvent('invoice.paid', { invoiceId: 'in_dup', subscriptionId: sub.providerSubscriptionId, amount: 2900, currency: 'usd' });
    const send = () => request(app).post('/api/v1/webhooks/billing/test').set({ 'Content-Type': 'application/octet-stream', ...e.headers }).send(e.raw);
    assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 200);
    assert.equal(await Invoice.countDocuments({ account: acct._id }), before + 1);
  });

  it('marks a failed payment and tells the owner', async () => {
    const acct = await globex();
    const sub = await Subscription.findOne({ account: acct._id });
    const e = testProvider.signedEvent('invoice.failed', { invoiceId: 'in_fail', subscriptionId: sub.providerSubscriptionId, amount: 2900, currency: 'usd' });
    await request(app).post('/api/v1/webhooks/billing/test').set({ 'Content-Type': 'application/octet-stream', ...e.headers }).send(e.raw).expect(200);
    assert.equal((await Subscription.findOne({ account: acct._id })).status, 'past_due');
    assert.equal((await api('get', GLOBEX, '/billing/overview')).body.subscription.status, 'past_due');
    const paid = testProvider.signedEvent('invoice.paid', { invoiceId: 'in_recover', subscriptionId: sub.providerSubscriptionId, amount: 2900, currency: 'usd', periodEnd: new Date(Date.now() + 30 * 864e5).toISOString() });
    await request(app).post('/api/v1/webhooks/billing/test').set({ 'Content-Type': 'application/octet-stream', ...paid.headers }).send(paid.raw).expect(200);
    assert.equal((await Subscription.findOne({ account: acct._id })).status, 'active', 'a later successful payment recovers it');
  });
});

describe('downgrading and cancelling', () => {
  it('previews what a downgrade would stop, and blocks one the account does not fit', async () => {
    const preview = await api('get', GLOBEX, '/billing/change-preview?plan=free');
    assert.equal(preview.body.direction, 'downgrade');
    assert.equal(preview.body.effective, 'period_end');
    assert.ok(preview.body.warnings.some((w) => /1 API key/.test(w)), JSON.stringify(preview.body.warnings));
    assert.ok(preview.body.warnings.some((w) => /Public forms/.test(w)));

    for (let i = 0; i < 4; i++) await api('post', GLOBEX, '/workspaces', { name: `Extra space ${i}` }).expect(201);
    const blocked = await api('post', GLOBEX, '/billing/change-plan', { plan: 'free', confirm: true });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'DOWNGRADE_BLOCKED');
    assert.match(blocked.body.error.message, /workspaces/i);
    const list = (await api('get', GLOBEX, '/workspaces')).body.data;
    for (const w of list.filter((x) => x.name.startsWith('Extra space')).slice(0, 2)) await api('delete', GLOBEX, `/workspaces/${w._id}`).expect(204);
  });

  it('needs explicit confirmation, then schedules the change for the end of the period', async () => {
    assert.equal((await api('post', GLOBEX, '/billing/change-plan', { plan: 'free' })).status, 400);
    assert.equal((await api('post', GLOBEX, '/billing/change-plan', { plan: 'business', confirm: true })).status, 400, 'upgrades go through checkout');
    const res = await api('post', GLOBEX, '/billing/change-plan', { plan: 'free', confirm: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.subscription.cancelAtPeriodEnd, true);
    assert.equal((await globex()).plan, 'team', 'paid time is honoured: nothing changes yet');
    assert.equal((await api('get', GLOBEX, '/billing/overview')).body.subscription.cancelAtPeriodEnd, true);
  });

  it('can be undone before it takes effect', async () => {
    assert.equal((await api('post', GLOBEX, '/billing/resume')).status, 200);
    assert.equal((await Subscription.findOne({ account: (await globex())._id })).cancelAtPeriodEnd, false);
    assert.equal((await api('post', GLOBEX, '/billing/resume')).status, 409, 'nothing left to undo');
    await api('post', GLOBEX, '/billing/change-plan', { plan: 'free', confirm: true }).expect(200);
  });

  it('takes effect when the period ends: the plan drops, features stop, data stays', async () => {
    const acct = await globex();
    const key = (await api('post', GLOBEX, '/api-keys', { name: 'Before downgrade', scope: 'read' })).body.key;
    const useKey = () => request(app).get('/api/v1/workspaces').set({ Authorization: `Bearer ${key}` });
    assert.equal((await useKey()).status, 200);
    assert.equal(await applyDuePlanChanges(), 0, 'not due yet');

    await Subscription.updateOne({ account: acct._id }, { currentPeriodEnd: new Date(Date.now() - 1000) });
    assert.equal(await applyDuePlanChanges(), 1);
    assert.equal(await applyDuePlanChanges(), 0, 'applied once');
    assert.equal((await globex()).plan, 'free');
    const sub = await Subscription.findOne({ account: acct._id });
    assert.equal(sub.status, 'canceled');
    assert.equal((await useKey()).status, 402, 'the existing key stops working');
    assert.equal((await api('post', GLOBEX, '/api-keys', { name: 'Again', scope: 'read' })).status, 402);
    assert.ok((await api('get', GLOBEX, '/workspaces')).body.data.length >= 2, 'no data was deleted');
    assert.equal((await api('post', GLOBEX, '/billing/change-plan', { plan: 'free', confirm: true })).status, 400, 'already free');
  });

  it('a provider-side cancellation also ends the plan', async () => {
    const started = (await api('post', GLOBEX, '/billing/checkout', { plan: 'team' })).body;
    await api('post', GLOBEX, `/billing/test-checkout/${started.sessionId}/complete`, { outcome: 'succeeded' }).expect(200);
    assert.equal((await globex()).plan, 'team');
    const sub = await Subscription.findOne({ account: (await globex())._id });
    const e = testProvider.signedEvent('subscription.canceled', { subscriptionId: sub.providerSubscriptionId });
    await request(app).post('/api/v1/webhooks/billing/test').set({ 'Content-Type': 'application/octet-stream', ...e.headers }).send(e.raw).expect(200);
    assert.equal((await globex()).plan, 'free');
  });
});

describe('plan limits are enforced where things are created', () => {
  let dataform; let ws;
  before(async () => {
    ws = (await api('post', OWNER, '/workspaces', { name: 'Limits space' })).body.workspace;
    dataform = (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name: 'Limited', templateId: 'contacts' })).body.dataform;
  });
  const acme = () => Account.findOne({ plan: 'team' });
  const setLimit = async (n) => { const a = await acme(); await Account.updateOne({ _id: a._id }, { entitlementOverrides: { maxRecords: (await RecordModel.countDocuments({ account: a._id })) + n } }); };
  const clear = async () => Account.updateOne({ _id: (await acme())._id }, { $unset: { entitlementOverrides: '' } });
  const create = (name) => api('post', OWNER, `/dataforms/${dataform._id}/records`, { data: { name } });

  it('stops creating records at the record limit, with an upgrade message', async () => {
    await setLimit(2);
    assert.equal((await create('One')).status, 201);
    assert.equal((await create('Two')).status, 201);
    const over = await create('Three');
    assert.equal(over.status, 402);
    assert.equal(over.body.error.code, 'PLAN_LIMIT');
    assert.match(over.body.error.message, /Upgrade under Billing/);
    const rec = (await RecordModel.findOne({ dataform: dataform._id }))._id;
    assert.equal((await api('post', OWNER, `/dataforms/${dataform._id}/records/${rec}/copy`)).status, 402, 'copies count too');
    assert.equal((await api('patch', OWNER, `/dataforms/${dataform._id}/records/${rec}`, { data: { name: 'Edited' } })).status, 200, 'editing is never blocked');
  });

  it('imports the rows that fit and reports the rest', async () => {
    await clear(); await setLimit(1);
    const csv = 'Full name\nImp A\nImp B\nImp C\n';
    const up = await request(app).post(`/api/v1/dataforms/${dataform._id}/imports`).set({ Authorization: `Bearer ${tokens[OWNER]}` }).attach('file', Buffer.from(csv), 'p.csv');
    await api('post', OWNER, `/imports/${up.body.import._id}/start`, { mapping: [{ column: 0, field: 'name' }] }).expect(202);
    await drain();
    const job = (await api('get', OWNER, `/imports/${up.body.import._id}`)).body.import;
    assert.deepEqual(job.counts, { created: 1, updated: 0, skipped: 0, failed: 2 });
    assert.match(job.errors[0].message, /allows up to .* records/);
  });

  it('closes public forms when the account is full', async () => {
    await clear();
    (await import('../src/modules/publicforms/public.routes.js')).timing.minMs = 0;
    const form = (await api('post', OWNER, `/dataforms/${dataform._id}/forms`, { name: 'Full form', fields: [{ key: 'name' }] })).body.form;
    await setLimit(0);
    const page = await request(app).get(`/api/v1/public/forms/${form.token}`);
    const res = await request(app).post(`/api/v1/public/forms/${form.token}/submit`).send({ data: { name: 'Late' }, _t: page.body.formToken });
    assert.equal(res.status, 410);
    assert.equal(await RecordModel.countDocuments({ 'data.name': 'Late' }), 0);
    await clear();
  });

  it('turns public pages off after a downgrade, without deleting them', async () => {
    const form = (await api('post', OWNER, `/dataforms/${dataform._id}/forms`, { name: 'Plan gated', fields: [{ key: 'name' }] })).body.form;
    assert.equal((await request(app).get(`/api/v1/public/forms/${form.token}`)).status, 200);
    await Account.updateOne({ _id: (await acme())._id }, { entitlementOverrides: { publicPages: false } });
    assert.equal((await request(app).get(`/api/v1/public/forms/${form.token}`)).status, 404);
    assert.equal((await api('post', OWNER, `/dataforms/${dataform._id}/forms`, { name: 'Blocked', fields: [{ key: 'name' }] })).status, 402);
    await clear();
    assert.equal((await request(app).get(`/api/v1/public/forms/${form.token}`)).status, 200, 'and back on when the plan allows');
  });

  it('stops outbound webhooks from sending when the plan no longer allows them', async () => {
    const { WebhookDelivery } = await import('../src/modules/outbound/webhook.model.js');
    const { setLookup } = await import('../src/providers/http.js');
    setLookup(async () => [{ address: '93.184.216.34' }]);
    await api('post', OWNER, '/outbound-webhooks', { name: 'Plan hook', url: 'https://hooks.example.com/x', events: ['task.created'] }).expect(201);
    await Account.updateOne({ _id: (await acme())._id }, { entitlementOverrides: { apiAccess: false } });
    await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'Quiet' }).expect(201);
    assert.equal(await WebhookDelivery.countDocuments({}), 0, 'nothing was even queued');
    assert.equal((await api('post', OWNER, '/outbound-webhooks', { name: 'Another', url: 'https://hooks.example.com/y', events: ['task.created'] })).status, 402);
    await clear();
    setLookup(undefined);
  });
});

describe('billing that is not configured', () => {
  it('says so instead of pretending, and never sells a plan', async () => {
    const was = env.BILLING_PROVIDER;
    env.BILLING_PROVIDER = 'none';
    try {
      const overview = await api('get', OWNER, '/billing/overview');
      assert.equal(overview.body.provider.name, null);
      const res = await api('post', OWNER, '/billing/checkout', { plan: 'business' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'NOT_CONFIGURED');
      assert.equal((await request(app).post('/api/v1/webhooks/billing/test').send('{}')).status, 404);
    } finally { env.BILLING_PROVIDER = was; }
  });
});

describe('the Stripe adapter', () => {
  const secret = 'whsec_test_secret';
  const sig = (body, t = Math.floor(Date.now() / 1000), key = secret) => ({ 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}` });
  const withEnv = async (vars, fn) => { const old = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]])); Object.assign(env, vars); try { return await fn(); } finally { Object.assign(env, old); } };
  const CFG = { STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: secret, STRIPE_PRICE_TEAM: 'price_team', STRIPE_PRICE_BUSINESS: 'price_biz' };

  it('is only "configured" when everything it needs is present', async () => {
    assert.equal(stripeProvider.configured(), false);
    await withEnv(CFG, () => { assert.equal(stripeProvider.configured(), true); assert.equal(stripeProvider.mode, 'test'); });
    await withEnv({ ...CFG, STRIPE_SECRET_KEY: 'sk_live_abc' }, () => assert.equal(stripeProvider.mode, 'live'));
  });

  it('creates a hosted checkout session with the right price, and no card data', async () => {
    const calls = [];
    setFetch(async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }; });
    const out = await withEnv(CFG, () => stripeProvider.createCheckout({ account: { _id: 'acc1' }, plan: 'business', email: 'a@b.test', successUrl: 'https://app/ok', cancelUrl: 'https://app/no' }));
    assert.deepEqual(out, { sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk_test_123');
    const body = decodeURIComponent(calls[0].init.body);
    assert.match(body, /mode=subscription/);
    assert.match(body, /line_items\[0\]\[price\]=price_biz/);
    assert.match(body, /client_reference_id=acc1/);
    assert.match(body, /metadata\[plan\]=business/);
    await assert.rejects(() => withEnv({ ...CFG, STRIPE_PRICE_BUSINESS: undefined }, () => stripeProvider.createCheckout({ account: { _id: 'a' }, plan: 'business' })), /No Stripe price/);
    setFetch(async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'Your card was declined' } }) }));
    await assert.rejects(() => withEnv(CFG, () => stripeProvider.createCheckout({ account: { _id: 'a' }, plan: 'team' })), /declined/);
    setFetch(undefined);
  });

  it('verifies webhook signatures and maps events', async () => {
    await withEnv(CFG, () => {
      const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', subscription: 'sub_1', customer: 'cus_1', client_reference_id: 'acc1', metadata: { plan: 'team' } } } });
      const raw = Buffer.from(body);
      assert.deepEqual(stripeProvider.verifyWebhook(raw, sig(body)), { id: 'evt_1', type: 'checkout.completed', data: { sessionId: 'cs_1', subscriptionId: 'sub_1', customerId: 'cus_1', accountId: 'acc1', plan: 'team' } });
      assert.equal(stripeProvider.verifyWebhook(raw, sig(body, undefined, 'whsec_other')), null, 'wrong secret');
      assert.equal(stripeProvider.verifyWebhook(raw, sig(body, Math.floor(Date.now() / 1000) - 3600)), null, 'too old: replay protection');
      assert.equal(stripeProvider.verifyWebhook(Buffer.from(`${body} `), sig(body)), null, 'body was altered');
      assert.equal(stripeProvider.verifyWebhook(raw, {}), null);

      const unpaid = JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: 'cs_2', payment_status: 'unpaid' } } });
      assert.equal(stripeProvider.verifyWebhook(Buffer.from(unpaid), sig(unpaid)).type, null, 'an unpaid session is not a purchase');

      const inv = JSON.stringify({ id: 'evt_3', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1', amount_paid: 2900, currency: 'usd', number: 'A-001', hosted_invoice_url: 'https://inv', lines: { data: [{ period: { start: 1700000000, end: 1702592000 } }] } } } });
      const e = stripeProvider.verifyWebhook(Buffer.from(inv), sig(inv));
      assert.equal(e.type, 'invoice.paid');
      assert.equal(e.data.amount, 2900);
      assert.equal(e.data.periodEnd, new Date(1702592000 * 1000).toISOString());
      const del = JSON.stringify({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
      assert.equal(stripeProvider.verifyWebhook(Buffer.from(del), sig(del)).type, 'subscription.canceled');
      const other = JSON.stringify({ id: 'evt_5', type: 'customer.created', data: { object: {} } });
      assert.equal(stripeProvider.verifyWebhook(Buffer.from(other), sig(other)).type, null);
    });
  });

  it('end to end: a Stripe confirmation upgrades the right account, once', async () => {
    const acct = await globex();
    await Account.updateOne({ _id: acct._id }, { plan: 'free' });
    await Subscription.deleteMany({ account: acct._id });
    await CheckoutSession.create({ account: acct._id, plan: 'business', provider: 'stripe', providerSessionId: 'cs_live_like' });
    const event = { id: 'evt_s1', type: 'checkout.completed', data: { sessionId: 'cs_live_like', subscriptionId: 'sub_s1', customerId: 'cus_s1' } };
    assert.equal((await processBillingEvent('stripe', event)).handled, true);
    assert.equal((await processBillingEvent('stripe', event)).duplicate, true);
    assert.equal((await globex()).plan, 'business');
    const calls = [];
    setFetch(async (url, init) => { calls.push({ url, method: init.method }); return { ok: true, status: 200, json: async () => ({}) }; });
    await withEnv(CFG, () => stripeProvider.cancelSubscription({ providerSubscriptionId: 'sub_s1', atPeriodEnd: true }));
    assert.deepEqual(calls[0], { url: 'https://api.stripe.com/v1/subscriptions/sub_s1', method: 'POST' });
    setFetch(undefined);
  });
});

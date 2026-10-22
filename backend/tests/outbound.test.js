import './_env.js';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let mongod; let app; let drain; let setFetch; let setLookup; let WebhookDelivery; let OutboundWebhook;
const tokens = {}; const ids = {};
const OWNER = 'owner@acme.test'; const MEMBER = 'member@acme.test'; const GLOBEX = 'owner@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};

const received = [];
let respond = () => ({ status: 200 });
const network = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://hooks.example.com/')) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  const r = respond(u, init);
  received.push({ url: u, headers: init.headers, body: init.body, status: r.status });
  return { ok: r.status < 400, status: r.status, text: async () => '', json: async () => ({}) };
};
const settle = async () => { for (let k = 0; k < 8; k++) await drain({ now: () => new Date(Date.now() + k * 4 * 3600e3) }); };
const events = (type) => received.filter((r) => r.headers['X-OrgCRM-Event'] === type).map((r) => ({ ...r, json: JSON.parse(r.body) }));

let ws; let deals; let contacts; let hook; let secret;
const mkHook = (body) => api('post', OWNER, '/outbound-webhooks', { name: 'Receiver', url: 'https://hooks.example.com/a', events: ['record.created'], ...body });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ drain } = await import('../src/modules/queue/queue.js'));
  ({ setFetch, setLookup } = await import('../src/providers/http.js'));
  ({ WebhookDelivery, OutboundWebhook } = await import('../src/modules/outbound/webhook.model.js'));
  await seed();
  for (const name of ['Notification', 'Task', 'Comment', 'Follow']) await mongoose.model(name).deleteMany({});
  await mongoose.syncIndexes();
  app = createApp();
  setFetch(network);
  setLookup(async () => [{ address: '93.184.216.34' }]);
  for (const who of [OWNER, MEMBER, GLOBEX]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' });
    tokens[who] = res.body.accessToken; ids[who] = res.body.user._id;
  }
  ws = (await api('post', OWNER, '/workspaces', { name: 'Hook space' })).body.workspace;
  deals = (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name: 'Deals', templateId: 'deals' })).body.dataform;
  contacts = (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name: 'People', templateId: 'contacts' })).body.dataform;
});

after(async () => {
  setFetch(undefined); setLookup(undefined);
  await mongoose.disconnect();
  await mongod.stop();
});

describe('managing outbound webhooks', () => {
  it('is for account admins signed in as people, and validates what it is given', async () => {
    assert.equal((await api('get', MEMBER, '/outbound-webhooks')).status, 403);
    assert.equal((await api('post', MEMBER, '/outbound-webhooks', { name: 'x'.repeat(4), url: 'https://hooks.example.com/a', events: ['record.created'] })).status, 403);
    assert.equal((await mkHook({ events: [] })).status, 400);
    assert.equal((await mkHook({ events: ['record.exploded'] })).status, 400);
    assert.equal((await mkHook({ name: 'a' })).status, 400);
    for (const url of ['http://hooks.example.com/a', 'https://127.0.0.1/a', 'https://169.254.169.254/latest', 'ftp://hooks.example.com', 'not a url']) assert.equal((await mkHook({ url })).status, 400, url);
    setLookup(async () => [{ address: '10.1.1.1' }]);
    assert.match((await mkHook({ url: 'https://sneaky.example.com/a' })).body.error.message, /private or internal/);
    setLookup(async () => [{ address: '93.184.216.34' }]);
    assert.equal((await mkHook({ dataformIds: ['0'.repeat(24)] })).status, 400);
  });

  it('shows the signing secret once and never lists it', async () => {
    const res = await mkHook({ name: 'Main receiver', events: ['record.created', 'record.updated', 'record.deleted'], dataformIds: [deals._id] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    hook = res.body.webhook; secret = res.body.secret;
    assert.equal(secret.length, 48);
    assert.equal(hook.secret, undefined);
    const list = (await api('get', OWNER, '/outbound-webhooks')).body;
    assert.ok(!JSON.stringify(list).includes(secret));
    assert.ok(list.events.includes('task.created'));
    const raw = await mongoose.connection.collection('outboundwebhooks').findOne({ name: 'Main receiver' });
    assert.ok(raw.secret.startsWith('v1.') && !raw.secret.includes(secret), 'stored encrypted');
    assert.equal((await api('get', GLOBEX, '/outbound-webhooks')).body.data.length, 0);
    assert.equal((await api('patch', GLOBEX, `/outbound-webhooks/${hook._id}`, { name: 'Hijack' })).status, 404);
    assert.equal((await api('delete', GLOBEX, `/outbound-webhooks/${hook._id}`)).status, 404);
  });
});

describe('record events', () => {
  let rec;
  const verify = (call) => {
    const h = call.headers;
    const expected = crypto.createHmac('sha256', secret).update(`${h['X-OrgCRM-Timestamp']}.${call.body}`).digest('hex');
    assert.equal(h['X-OrgCRM-Signature'], `sha256=${expected}`);
  };

  it('delivers a signed event when a record is created', async () => {
    rec = (await api('post', MEMBER, `/dataforms/${deals._id}/records`, { data: { title: 'Hooked deal', value: 500, stage: 'qualified' } })).body.record;
    assert.equal(received.length, 0, 'delivery is in the background, not during the request');
    await drain();
    const [call] = events('record.created');
    assert.ok(call, JSON.stringify(received));
    verify(call);
    assert.equal(call.json.event, 'record.created');
    assert.equal(call.json.data.recordId, rec._id);
    assert.equal(call.json.data.record.title, 'Hooked deal');
    assert.equal(call.json.data.dataformName, 'Deals');
    assert.equal(call.headers['X-OrgCRM-Delivery'], call.json.id);
    assert.ok(Math.abs(Date.now() / 1000 - Number(call.headers['X-OrgCRM-Timestamp'])) < 60);
    assert.equal(call.headers['User-Agent'], 'OrgCRM-Webhook/1');
  });

  it('includes what changed on an update, and the last known data on a delete', async () => {
    await api('patch', OWNER, `/dataforms/${deals._id}/records/${rec._id}`, { data: { value: 900, stage: 'proposal' } }).expect(200);
    await drain();
    const upd = events('record.updated').at(-1).json.data;
    assert.deepEqual(upd.changes.map((c) => c.field).sort(), ['stage', 'value']);
    assert.deepEqual(upd.changes.find((c) => c.field === 'value'), { field: 'value', from: 500, to: 900 });
    await api('delete', OWNER, `/dataforms/${deals._id}/records/${rec._id}`).expect(204);
    await drain();
    const del = events('record.deleted').at(-1).json.data;
    assert.equal(del.recordId, rec._id);
    assert.equal(del.record.title, 'Hooked deal');
  });

  it('only sends what a webhook subscribed to, for the dataforms it chose', async () => {
    const before = received.length;
    await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Other form' } }).expect(201);
    const task = await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'Not subscribed' });
    assert.equal(task.status, 201);
    await drain();
    assert.equal(received.length, before, 'wrong dataform and unsubscribed events are not delivered');
  });

  it('leaves out fields hidden from lists', async () => {
    const f = (await api('get', OWNER, `/dataforms/${deals._id}`)).body.fields.find((x) => x.key === 'won');
    await api('patch', OWNER, `/dataforms/${deals._id}/fields/${f._id}`, { visibility: { list: false } }).expect(200);
    await api('post', OWNER, `/dataforms/${deals._id}/records`, { data: { title: 'Hidden field', won: true } }).expect(201);
    await drain();
    const data = events('record.created').at(-1).json.data.record;
    assert.equal(data.title, 'Hidden field');
    assert.equal('won' in data, false);
  });

  it('applies to changes made by API keys, bulk edits and copies', async () => {
    const key = (await api('post', OWNER, '/api-keys', { name: 'Hooks key', scope: 'write' })).body.key;
    const count = () => events('record.created').length;
    const n0 = count();
    await request(app).post(`/api/v1/dataforms/${deals._id}/records`).set({ Authorization: `Bearer ${key}` }).send({ data: { title: 'Via key' } }).expect(201);
    const created = (await api('post', OWNER, `/dataforms/${deals._id}/records`, { data: { title: 'Bulk source' } })).body.record;
    await api('post', OWNER, `/dataforms/${deals._id}/records/bulk`, { action: 'update', ids: [created._id], data: { value: 77 } }).expect(200);
    await api('post', OWNER, `/dataforms/${deals._id}/records/${created._id}/copy`).expect(201);
    await drain();
    assert.equal(count() - n0, 3, 'key create + create + copy');
    assert.ok(events('record.updated').some((e) => e.json.data.recordId === created._id && e.json.data.changes[0].to === 77));
  });
});

describe('other events', () => {
  it('reports tasks, comments and files', async () => {
    const wide = (await mkHook({ name: 'Everything', events: ['task.created', 'task.updated', 'task.deleted', 'comment.created', 'attachment.created', 'attachment.deleted'] })).body;
    const t = (await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'Call back', assignees: [ids[MEMBER]], priority: 'high' })).body.task;
    await api('patch', OWNER, `/tasks/${t._id}`, { status: 'done' }).expect(200);
    const rec = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Event target' } })).body.record;
    await api('post', OWNER, `/dataforms/${contacts._id}/records/${rec._id}/comments`, { body: 'Hello webhook' }).expect(201);
    const up = await request(app).post(`/api/v1/dataforms/${contacts._id}/records/${rec._id}/attachments`).set({ Authorization: `Bearer ${tokens[OWNER]}` }).attach('file', Buffer.from('data'), { filename: 'a.txt', contentType: 'text/plain' });
    await api('delete', OWNER, `/attachments/${up.body.attachment._id}`).expect(204);
    await api('delete', OWNER, `/tasks/${t._id}`).expect(204);
    await drain();
    assert.equal(events('task.created').at(-1).json.data.task.title, 'Call back');
    assert.deepEqual(events('task.created').at(-1).json.data.task.assignees, [ids[MEMBER]]);
    assert.equal(events('task.updated').at(-1).json.data.task.status, 'done');
    assert.ok(events('task.deleted').length >= 1);
    assert.equal(events('comment.created').at(-1).json.data.body, 'Hello webhook');
    assert.equal(events('attachment.created').at(-1).json.data.filename, 'a.txt');
    assert.ok(events('attachment.deleted').length >= 1);
    await api('delete', OWNER, `/outbound-webhooks/${wide.webhook._id}`).expect(204);
  });
});

describe('reliability', () => {
  const fresh = async (events_ = ['record.created']) => (await mkHook({ name: `Flaky ${Math.random()}`, url: 'https://hooks.example.com/flaky', events: events_ })).body;
  const create = (title) => api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: title } }).expect(201);

  it('retries with the same event id until the receiver accepts', async () => {
    const h = await fresh();
    let calls = 0;
    respond = (u) => (u.endsWith('/flaky') && ++calls < 3 ? { status: 503 } : { status: 200 });
    received.length = 0;
    await create('Retry me');
    await drain();
    assert.equal((await WebhookDelivery.findOne({ webhook: h.webhook._id })).status, 'queued', 'waiting to retry');
    await settle();
    const d = await WebhookDelivery.findOne({ webhook: h.webhook._id }).lean();
    assert.equal(d.status, 'succeeded');
    assert.equal(d.attempts, 3);
    assert.equal(d.responseStatus, 200);
    const flaky = received.filter((r) => r.url.endsWith('/flaky'));
    assert.equal(new Set(flaky.map((r) => r.headers['X-OrgCRM-Delivery'])).size, 1, 'every retry carries the same event id');
    assert.equal((await OutboundWebhook.findById(h.webhook._id)).lastStatus, 'ok');
    respond = () => ({ status: 200 });
    await api('delete', OWNER, `/outbound-webhooks/${h.webhook._id}`).expect(204);
  });

  it('treats redirects as failures and gives up after the retry limit', async () => {
    const h = await fresh();
    respond = (u) => (u.endsWith('/flaky') ? { status: 302 } : { status: 200 });
    await create('Redirected');
    await settle();
    const d = await WebhookDelivery.findOne({ webhook: h.webhook._id }).lean();
    assert.equal(d.status, 'failed');
    assert.equal(d.attempts, 6);
    assert.match(d.error, /redirected/);
    assert.equal((await OutboundWebhook.findById(h.webhook._id)).failureCount, 1);
    await api('delete', OWNER, `/outbound-webhooks/${h.webhook._id}`).expect(204);
  });

  it('switches itself off after ten failed deliveries in a row and tells its owner', async () => {
    const h = await fresh();
    respond = (u) => (u.endsWith('/flaky') ? { status: 500 } : { status: 200 });
    for (let i = 0; i < 10; i++) await create(`Failing ${i}`);
    await settle();
    const stored = await OutboundWebhook.findById(h.webhook._id).lean();
    assert.equal(stored.enabled, false);
    assert.match(stored.disabledReason, /10 failed deliveries/);
    const note = (await api('get', OWNER, '/notifications?limit=30')).body.data.find((n) => n.title.includes('was switched off'));
    assert.ok(note);
    const audit = (await api('get', OWNER, '/audit?action=webhook.auto_disabled')).body.data;
    assert.equal(audit.length, 1);
    const before = received.length;
    await create('After disabled');
    await settle();
    assert.equal(received.length, before, 'a disabled webhook receives nothing');
    respond = () => ({ status: 200 });
    const re = await api('patch', OWNER, `/outbound-webhooks/${h.webhook._id}`, { enabled: true });
    assert.equal(re.body.webhook.failureCount, 0, 're-enabling resets the failure count');
    await api('delete', OWNER, `/outbound-webhooks/${h.webhook._id}`).expect(204);
  });

  it('does not retry a URL that has become internal, and fails it straight away', async () => {
    const h = await fresh();
    setLookup(async () => [{ address: '10.0.0.9' }]);
    const before = received.length;
    await create('Rebinding');
    await settle();
    setLookup(async () => [{ address: '93.184.216.34' }]);
    const d = await WebhookDelivery.findOne({ webhook: h.webhook._id }).lean();
    assert.equal(d.status, 'failed');
    assert.equal(d.attempts, 1, 'no point retrying');
    assert.match(d.error, /private or internal/);
    assert.equal(received.length, before, 'nothing was sent');
    await api('delete', OWNER, `/outbound-webhooks/${h.webhook._id}`).expect(204);
  });
});

describe('testing, secrets and redelivery', () => {
  it('sends a real test ping and reports what the receiver said', async () => {
    const h = (await mkHook({ name: 'Pinged', url: 'https://hooks.example.com/ping' })).body;
    respond = () => ({ status: 200 });
    const ok = await api('post', OWNER, `/outbound-webhooks/${h.webhook._id}/test`);
    assert.deepEqual([ok.body.ok, ok.body.status], [true, 200]);
    const ping = events('webhook.test').at(-1);
    const expected = crypto.createHmac('sha256', h.secret).update(`${ping.headers['X-OrgCRM-Timestamp']}.${ping.body}`).digest('hex');
    assert.equal(ping.headers['X-OrgCRM-Signature'], `sha256=${expected}`);
    respond = () => ({ status: 500 });
    const bad = await api('post', OWNER, `/outbound-webhooks/${h.webhook._id}/test`);
    assert.equal(bad.body.ok, false);
    assert.match(bad.body.error, /500/);
    respond = () => ({ status: 200 });

    const rotated = (await api('post', OWNER, `/outbound-webhooks/${h.webhook._id}/rotate-secret`)).body.secret;
    assert.notEqual(rotated, h.secret);
    await api('post', OWNER, `/outbound-webhooks/${h.webhook._id}/test`);
    const after = events('webhook.test').at(-1);
    assert.equal(after.headers['X-OrgCRM-Signature'], `sha256=${crypto.createHmac('sha256', rotated).update(`${after.headers['X-OrgCRM-Timestamp']}.${after.body}`).digest('hex')}`, 'signed with the new secret');
    assert.equal((await api('post', GLOBEX, `/outbound-webhooks/${h.webhook._id}/test`)).status, 404);
    await api('delete', OWNER, `/outbound-webhooks/${h.webhook._id}`).expect(204);
  });

  it('lists deliveries and can redeliver one under the same event id', async () => {
    const h = (await mkHook({ name: 'Redeliver', url: 'https://hooks.example.com/redeliver', events: ['task.created'] })).body;
    await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'Redeliver me' }).expect(201);
    await drain();
    const list = await api('get', OWNER, `/outbound-webhooks/${h.webhook._id}/deliveries`);
    assert.equal(list.body.total, 1);
    const first = list.body.data[0];
    assert.equal(first.status, 'succeeded');
    assert.equal((await api('get', GLOBEX, `/outbound-webhooks/${h.webhook._id}/deliveries`)).status, 404);
    assert.equal((await api('post', GLOBEX, `/outbound-webhooks/deliveries/${first._id}/redeliver`)).status, 404);
    assert.equal((await api('post', OWNER, `/outbound-webhooks/deliveries/${first._id}/redeliver`)).status, 202);
    await drain();
    const after = (await api('get', OWNER, `/outbound-webhooks/${h.webhook._id}/deliveries`)).body;
    assert.equal(after.total, 2);
    assert.equal(after.data[0].eventId, first.eventId, 'receivers can recognise the repeat');
    assert.equal((await api('get', OWNER, `/outbound-webhooks/${h.webhook._id}/deliveries?status=failed`)).body.total, 0);
  });
});

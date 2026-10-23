import './_env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let mongod; let app; let ApiKey; let Follow;
const tokens = {};
const OWNER = 'owner@acme.test'; const MEMBER = 'member@acme.test'; const GLOBEX = 'owner@globex.test';
const user = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};
const withKey = (method, key, url, body, header = 'bearer') => {
  const r = request(app)[method](`/api/v1${url}`).set(header === 'bearer' ? { Authorization: `Bearer ${key}` } : { 'X-API-Key': key });
  return body === undefined ? r : r.send(body);
};

let sales; let privateWs; let deals; let readKey; let writeKey; let scopedKey; let ids = {};

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ ApiKey } = await import('../src/modules/apikeys/apikey.model.js'));
  ({ Follow } = await import('../src/modules/comments/comment.model.js'));
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
  for (const who of [OWNER, MEMBER, GLOBEX]) tokens[who] = (await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' })).body.accessToken;
  const workspaces = (await user('get', OWNER, '/workspaces')).body.data;
  sales = workspaces.find((w) => w.name === 'Sales Pipeline');
  privateWs = workspaces.find((w) => w.name === 'Executive Planning');
  const forms = (await user('get', OWNER, `/dataforms?workspaceId=${sales._id}`)).body.data;
  deals = forms.find((f) => f.name === 'Deals');
  const mk = async (body) => (await user('post', OWNER, '/api-keys', body)).body;
  readKey = await mk({ name: 'Reporting', scope: 'read' });
  writeKey = await mk({ name: 'Website sync', scope: 'write' });
  scopedKey = await mk({ name: 'Scoped', scope: 'write', workspaceIds: [sales._id] });
  ids = { privateForm: (await user('post', OWNER, '/dataforms', { workspaceId: privateWs._id, name: 'Secret form', templateId: 'tickets' })).body.dataform._id };
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('managing API keys', () => {
  it('is for account admins signed in as a person', async () => {
    assert.equal((await user('get', MEMBER, '/api-keys')).status, 403);
    assert.equal((await user('post', MEMBER, '/api-keys', { name: 'x'.repeat(5), scope: 'read' })).status, 403);
    assert.equal((await withKey('post', writeKey.key, '/api-keys', { name: 'Escalate', scope: 'write' })).status, 403, 'a key cannot create keys');
    assert.equal((await withKey('get', readKey.key, '/api-keys')).status, 403);
    assert.equal((await request(app).get('/api/v1/api-keys')).status, 401);
  });

  it('validates input, shows the key once, and stores only a hash', async () => {
    assert.equal((await user('post', OWNER, '/api-keys', { name: 'a', scope: 'read' })).status, 400);
    assert.equal((await user('post', OWNER, '/api-keys', { name: 'Admin scope', scope: 'admin' })).status, 400);
    assert.equal((await user('post', OWNER, '/api-keys', { name: 'Other tenant', scope: 'read', workspaceIds: ['f'.repeat(24)] })).status, 400, 'workspaces must exist in the account');
    assert.match(readKey.key, /^ocrm_[A-Za-z0-9_-]{43}$/);
    assert.equal(readKey.apiKey.hash, undefined);
    const stored = await mongoose.connection.collection('apikeys').findOne({ name: 'Reporting' });
    assert.ok(stored.hash && !JSON.stringify(stored).includes(readKey.key), 'the plaintext key is never stored');
    const list = (await user('get', OWNER, '/api-keys')).body.data;
    assert.ok(!JSON.stringify(list).includes(readKey.key) && list.every((k) => k.hash === undefined));
    assert.equal(list.find((k) => k.name === 'Reporting').prefix, readKey.key.slice(0, 11));
  });
});

describe('what a key can read', () => {
  it('works with a Bearer header or X-API-Key and only sees what its access level allows', async () => {
    const a = await withKey('get', readKey.key, '/workspaces');
    assert.equal(a.status, 200);
    assert.ok(a.body.data.some((w) => w.name === 'Sales Pipeline'));
    assert.ok(!a.body.data.some((w) => w.name === 'Executive Planning'), 'private workspaces stay private');
    assert.equal((await withKey('get', readKey.key, '/workspaces', undefined, 'header')).status, 200);
    assert.equal((await withKey('get', readKey.key, `/workspaces/${privateWs._id}`)).status, 404);
    assert.equal((await withKey('get', readKey.key, `/dataforms/${ids.privateForm}`)).status, 404);
  });

  it('lists records with plain query parameters: pagination, sorting, search, JSON filters and field selection', async () => {
    const page = await withKey('get', readKey.key, `/dataforms/${deals._id}/records?limit=5&page=2&sort=value:desc&fields=title,value`);
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.equal(page.body.data.length, 5);
    assert.equal(page.body.page, 2);
    assert.ok(page.body.total >= 20);
    assert.deepEqual(Object.keys(page.body.data[0].data).sort(), ['title', 'value']);
    const values = page.body.data.map((r) => r.data.value);
    assert.deepEqual(values, [...values].sort((x, y) => y - x));

    const filter = encodeURIComponent(JSON.stringify({ op: 'and', conditions: [{ field: 'stage', operator: 'eq', value: 'lost' }] }));
    const lost = await withKey('get', readKey.key, `/dataforms/${deals._id}/records?filter=${filter}&fields=stage`);
    assert.ok(lost.body.total >= 2 && lost.body.data.every((r) => r.data.stage === 'lost'));
    assert.equal((await withKey('get', readKey.key, `/dataforms/${deals._id}/records?q=Initech&limit=3`)).status, 200);
    assert.equal((await withKey('get', readKey.key, `/dataforms/${deals._id}/records?filter=not-json`)).status, 400);
    assert.equal((await withKey('get', readKey.key, `/dataforms/${deals._id}/records?filter=${encodeURIComponent('{"op":"and","conditions":[{"field":"ghost","operator":"eq","value":1}]}')}`)).status, 400);
    assert.equal((await withKey('get', readKey.key, `/dataforms/${deals._id}/records?fields=title,ghost`)).status, 400);
    assert.equal((await withKey('get', readKey.key, `/dataforms/${deals._id}/records?limit=500`)).status, 400);
    const one = await withKey('get', readKey.key, `/dataforms/${deals._id}/records/${page.body.data[0]._id}?fields=title`);
    assert.deepEqual(Object.keys(one.body.record.data), ['title']);
  });

  it('keeps the same list available to signed-in users, with the same shape', async () => {
    const res = await user('get', MEMBER, `/dataforms/${deals._id}/records?limit=2&fields=title`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 2);
    assert.ok(res.body.data[0]._label);
  });
});

describe('what a key can change', () => {
  let created;
  it('a read key cannot write; a write key can create, edit and delete records', async () => {
    const denied = await withKey('post', readKey.key, `/dataforms/${deals._id}/records`, { data: { title: 'Nope' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.message, 'This API key is read-only');
    assert.equal((await withKey('post', readKey.key, `/dataforms/${deals._id}/records/query`, { limit: 1 })).status, 200, 'read-only queries are allowed');

    const res = await withKey('post', writeKey.key, `/dataforms/${deals._id}/records`, { data: { title: 'From the API', value: 1234, stage: 'qualified' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    created = res.body.record;
    assert.equal(created.data.value, 1234);
    assert.equal((await withKey('patch', writeKey.key, `/dataforms/${deals._id}/records/${created._id}`, { data: { value: 2000 } })).body.record.data.value, 2000);
    const bad = await withKey('post', writeKey.key, `/dataforms/${deals._id}/records`, { data: { title: 'x', value: 'abc' } });
    assert.equal(bad.status, 400, 'the same validation as the app applies');
    assert.equal((await withKey('post', writeKey.key, `/dataforms/${deals._id}/records/bulk`, { action: 'update', ids: [created._id], data: { value: 3000 } })).body.affected, 1);
  });

  it('shows the key in the record history and does not create follows for it', async () => {
    const history = (await user('get', OWNER, `/dataforms/${deals._id}/records/${created._id}/history`)).body.data;
    assert.ok(history.every((h) => h.user?.name === 'API key: Website sync'), JSON.stringify(history.map((h) => h.user)));
    assert.equal(await Follow.countDocuments({ record: created._id }), 0);
  });

  it('applies before-save workflow rules to API writes too', async () => {
    const res = await withKey('post', writeKey.key, `/dataforms/${deals._id}/records`, { data: { title: 'Cheap win', stage: 'won', value: 5 } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'WORKFLOW_VALIDATION');
    assert.equal((await withKey('delete', writeKey.key, `/dataforms/${deals._id}/records/${created._id}`)).status, 204);
  });

  it('refuses everything outside the allowlist, even for write keys', async () => {
    const forbidden = [
      ['get', '/users'], ['get', '/integrations'], ['get', '/workflows?workspaceId=' + sales._id], ['get', '/tasks'], ['get', '/notifications'], ['get', '/accounts/current'],
      ['get', '/audit'], ['post', '/workspaces'], ['post', `/dataforms/${deals._id}/fields`], ['delete', `/dataforms/${deals._id}`], ['get', '/dashboards'], ['get', '/reports?workspaceId=' + sales._id],
      ['get', `/dataforms/${deals._id}/views`], ['post', '/auth/logout-all'], ['patch', '/users/me'],
    ];
    for (const [method, url] of forbidden) {
      const res = await withKey(method, writeKey.key, url, method === 'get' ? undefined : {});
      assert.equal(res.status, 403, `${method} ${url} -> ${res.status}`);
      assert.equal(res.body.error.code, 'API_KEY_FORBIDDEN');
    }
    const rec = (await withKey('get', writeKey.key, `/dataforms/${deals._id}/records?limit=1`)).body.data[0];
    for (const sub of ['comments', 'attachments', 'interactions', 'follow']) assert.equal((await withKey('get', writeKey.key, `/dataforms/${deals._id}/records/${rec._id}/${sub}`)).status, 403, sub);
  });
});

describe('key limits and lifecycle', () => {
  it('limits a key to the workspaces it was issued for', async () => {
    assert.deepEqual((await withKey('get', scopedKey.key, '/workspaces')).body.data.map((w) => w.name), ['Sales Pipeline']);
    assert.equal((await withKey('get', scopedKey.key, `/dataforms?workspaceId=${sales._id}`)).status, 200);
    const other = (await user('get', OWNER, '/workspaces')).body.data.find((w) => w.name === 'Customer Support');
    assert.equal((await withKey('get', scopedKey.key, `/dataforms?workspaceId=${other._id}`)).status, 404);
    const supportForm = (await user('get', OWNER, `/dataforms?workspaceId=${other._id}`)).body.data[0];
    assert.equal((await withKey('post', scopedKey.key, `/dataforms/${supportForm._id}/records/query`, {})).status, 404);
    assert.equal((await withKey('get', writeKey.key, `/dataforms?workspaceId=${other._id}`)).status, 200, 'an unrestricted key can');
  });

  it('is isolated per account', async () => {
    const { Account } = await import('../src/modules/accounts/account.model.js');
    // API keys are a paid feature. Without it the free plan is refused; a per-account override can grant it.
    assert.equal((await user('post', GLOBEX, '/api-keys', { name: 'Globex key', scope: 'write' })).status, 402);
    await Account.updateOne({ name: /globex/i }, { entitlementOverrides: { apiAccess: true } });
    const theirs = await user('post', GLOBEX, '/api-keys', { name: 'Globex key', scope: 'write' });
    assert.equal(theirs.status, 201);
    assert.equal((await withKey('get', theirs.body.key, `/dataforms/${deals._id}/records`)).status, 404);
    assert.equal((await withKey('get', theirs.body.key, `/dataforms?workspaceId=${sales._id}`)).status, 404);
    assert.equal((await user('get', GLOBEX, '/api-keys')).body.data.length, 1, 'keys are listed per account');
    assert.equal((await user('delete', GLOBEX, `/api-keys/${readKey.apiKey._id}`)).status, 404, 'and cannot be revoked across accounts');
  });

  it('rejects unknown, expired and revoked keys', async () => {
    assert.equal((await withKey('get', 'ocrm_notarealkey', '/workspaces')).status, 401);
    assert.equal((await withKey('get', `ocrm_${'a'.repeat(43)}`, '/workspaces')).status, 401);
    const short = (await user('post', OWNER, '/api-keys', { name: 'Short lived', scope: 'read', expiresInDays: 1 })).body;
    assert.equal((await withKey('get', short.key, '/workspaces')).status, 200);
    await ApiKey.updateOne({ _id: short.apiKey._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await withKey('get', short.key, '/workspaces')).status, 401);

    const doomed = (await user('post', OWNER, '/api-keys', { name: 'To revoke', scope: 'write' })).body;
    assert.equal((await withKey('get', doomed.key, '/workspaces')).status, 200);
    assert.equal((await user('delete', OWNER, `/api-keys/${doomed.apiKey._id}`)).status, 204);
    assert.equal((await withKey('get', doomed.key, '/workspaces')).status, 401, 'revoked keys stop working immediately');
    assert.equal((await user('delete', OWNER, `/api-keys/${doomed.apiKey._id}`)).status, 404);
    const stored = await ApiKey.findById(doomed.apiKey._id).lean();
    assert.ok(stored.revokedAt, 'revoked keys are kept for the record');
  });

  it('records when a key was last used', async () => {
    await withKey('get', readKey.key, '/workspaces');
    const k = await ApiKey.findById(readKey.apiKey._id).lean();
    assert.ok(k.lastUsedAt && Date.now() - k.lastUsedAt.getTime() < 60_000);
  });
});

describe('audit log', () => {
  it('records sensitive actions for account admins, and only for them', async () => {
    await user('put', OWNER, '/integrations/slack', { secrets: { webhookUrl: 'https://hooks.slack.com/services/T1/B1/x' } });
    const log = await user('get', OWNER, '/audit?limit=50');
    assert.equal(log.status, 200);
    const actions = log.body.data.map((e) => e.action);
    for (const a of ['api_key.created', 'api_key.revoked', 'integration.connected']) assert.ok(actions.includes(a), a);
    const entry = log.body.data.find((e) => e.action === 'api_key.created');
    assert.match(entry.summary, /Reporting|Website sync|Scoped|Short lived|To revoke/);
    assert.equal(entry.user.email, 'owner@acme.test');
    assert.ok(log.body.actions.includes('api_key.created'));
    assert.ok(!JSON.stringify(log.body).includes('hooks.slack.com'), 'secrets never reach the log');
    assert.equal((await user('get', OWNER, '/audit?action=api_key.revoked')).body.data.every((e) => e.action === 'api_key.revoked'), true);
    assert.equal((await user('get', MEMBER, '/audit')).status, 403);
    assert.equal((await user('get', GLOBEX, '/audit')).body.data.every((e) => e.action === 'api_key.created'), true, 'each account sees only its own entries');
    assert.equal((await withKey('get', writeKey.key, '/audit')).status, 403);
  });
});

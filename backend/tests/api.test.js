import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';

let mongod;
let app;
const H = { 'X-Requested-With': 'orgcrm' };

const login = async (email) => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Passw0rd!demo' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { token: res.body.accessToken, cookie: res.headers['set-cookie'] };
};
const as = (token) => ({ Authorization: `Bearer ${token}` });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('auth', () => {
  it('rejects bad credentials and unauthenticated access', async () => {
    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'owner@acme.test', password: 'nope-nope1' });
    assert.equal(bad.status, 401);
    assert.equal((await request(app).get('/api/v1/workspaces')).status, 401);
  });

  it('signs up a new tenant as owner and validates input', async () => {
    const weak = await request(app).post('/api/v1/auth/signup').send({ name: 'A', email: 'a@b.co', password: 'short', accountName: 'X Co' });
    assert.equal(weak.status, 400);
    const ok = await request(app).post('/api/v1/auth/signup').send({ name: 'Newbie', email: 'new@owner.test', password: 'Sup3rsecret', accountName: 'New Co' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.role, 'owner');
    assert.equal(ok.body.user.passwordHash, undefined);
    const dup = await request(app).post('/api/v1/auth/signup').send({ name: 'Newbie', email: 'new@owner.test', password: 'Sup3rsecret', accountName: 'New Co' });
    assert.equal(dup.status, 409);
  });

  it('rotates refresh tokens and blocks replay and missing CSRF header', async () => {
    const { cookie } = await login('owner@acme.test');
    assert.equal((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status, 400);
    const first = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', cookie);
    assert.equal(first.status, 200);
    assert.ok(first.body.accessToken);
    const replay = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', cookie);
    assert.equal(replay.status, 401);
  });

  it('logout revokes the refresh session', async () => {
    const { cookie } = await login('owner@acme.test');
    await request(app).post('/api/v1/auth/logout').set(H).set('Cookie', cookie).expect(204);
    assert.equal((await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', cookie)).status, 401);
  });
});

describe('tenant isolation and permissions', () => {
  it('never lists or reads another tenant\'s workspaces', async () => {
    const acme = await login('owner@acme.test');
    const globex = await login('owner@globex.test');
    const acmeList = (await request(app).get('/api/v1/workspaces').set(as(acme.token))).body.data;
    const globexList = (await request(app).get('/api/v1/workspaces').set(as(globex.token))).body.data;
    assert.equal(acmeList.length, 4);
    assert.equal(globexList.length, 2);
    const res = await request(app).get(`/api/v1/workspaces/${globexList[0]._id}`).set(as(acme.token));
    assert.equal(res.status, 404);
    assert.equal((await request(app).patch(`/api/v1/workspaces/${globexList[0]._id}`).set(as(acme.token)).send({ name: 'Hacked' })).status, 404);
    assert.equal((await request(app).delete(`/api/v1/workspaces/${globexList[0]._id}`).set(as(acme.token))).status, 404);
  });

  it('hides private workspaces from non-members but not from admins', async () => {
    const member = await login('member@acme.test');
    const admin = await login('admin@acme.test');
    const names = async (t) => (await request(app).get('/api/v1/workspaces').set(as(t.token))).body.data.map((w) => w.name);
    assert.ok(!(await names(member)).includes('Executive Planning'));
    assert.ok((await names(admin)).includes('Executive Planning'));
  });

  it('enforces role permissions and ignores mass-assigned fields', async () => {
    const viewer = await login('viewer@acme.test');
    assert.equal((await request(app).post('/api/v1/workspaces').set(as(viewer.token)).send({ name: 'Nope' })).status, 403);

    const member = await login('member@acme.test');
    const created = await request(app).post('/api/v1/workspaces').set(as(member.token)).send({ name: 'Mine', account: new mongoose.Types.ObjectId(), slug: 'evil' });
    assert.equal(created.status, 201);
    const { Account } = await import('../src/modules/accounts/account.model.js');
    const acme = await Account.findOne({ slug: 'acme-industries' });
    assert.equal(String(created.body.workspace.account), String(acme._id));
    assert.equal(created.body.workspace.slug, 'mine');

    // another member who is not a workspace admin cannot edit it
    const taylor = await login('taylor@acme.test');
    assert.equal((await request(app).patch(`/api/v1/workspaces/${created.body.workspace._id}`).set(as(taylor.token)).send({ name: 'x1' })).status, 403);
    assert.equal((await request(app).delete(`/api/v1/workspaces/${created.body.workspace._id}`).set(as(member.token))).status, 204);
  });

  it('enforces the plan workspace quota', async () => {
    const globex = await login('owner@globex.test');
    for (let i = 0; i < 3; i++) await request(app).post('/api/v1/workspaces').set(as(globex.token)).send({ name: `Extra ${i}` }).expect(201);
    const over = await request(app).post('/api/v1/workspaces').set(as(globex.token)).send({ name: 'One too many' });
    assert.equal(over.status, 402);
    assert.equal(over.body.error.code, 'PLAN_LIMIT');
    assert.match(over.body.error.message, /Free plan allows up to 5 workspaces/);
  });

  it('protects member management', async () => {
    const admin = await login('admin@acme.test');
    const list = (await request(app).get('/api/v1/users').set(as(admin.token))).body.data;
    assert.equal(list.length, 5);
    const owner = list.find((m) => m.role === 'owner');
    assert.equal((await request(app).patch(`/api/v1/users/${owner.id}`).set(as(admin.token)).send({ role: 'viewer' })).status, 403);
    const member = await login('member@acme.test');
    assert.equal((await request(app).patch(`/api/v1/users/${owner.id}`).set(as(member.token)).send({ role: 'viewer' })).status, 403);
  });

  it('rejects operator-injection style ids and bodies', async () => {
    const owner = await login('owner@acme.test');
    assert.equal((await request(app).get('/api/v1/workspaces/not-an-id').set(as(owner.token))).status, 400);
    const res = await request(app).post('/api/v1/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    assert.equal(res.status, 400);
  });
});

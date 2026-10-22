import './_env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let mongod; let app; let spec; let auth;
const ID = 'a'.repeat(24);
const fill = (path) => path.replace(/\{token\}/g, 'x'.repeat(43)).replace(/\{\w+\}/g, ID);

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  await seed();
  app = createApp();
  const login = await request(app).post('/api/v1/auth/login').send({ email: 'owner@acme.test', password: 'Passw0rd!demo' });
  auth = { Authorization: `Bearer ${login.body.accessToken}`, 'X-Requested-With': 'orgcrm' };
  spec = (await request(app).get('/api/v1/openapi.json')).body;
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const operations = () => Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item).map(([method, op]) => ({ method, path, op })));

describe('OpenAPI document', () => {
  it('is served without signing in, as valid-looking OpenAPI 3.1', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /json/);
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.info.title && spec.info.version && spec.servers.length);
    assert.ok(operations().length > 60);
    for (const { method, path, op } of operations()) {
      const where = `${method.toUpperCase()} ${path}`;
      assert.ok(['get', 'post', 'put', 'patch', 'delete'].includes(method), where);
      assert.ok(op.summary, `${where} needs a summary`);
      assert.ok(op.tags?.length, `${where} needs a tag`);
      assert.ok(Object.keys(op.responses).length >= 2, `${where} needs responses`);
      const declared = new Set(op.parameters.filter((p) => p.in === 'path').map((p) => p.name));
      const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      assert.deepEqual([...declared].sort(), inPath.sort(), `${where} path parameters`);
    }
  });

  it('has no dangling $refs and no secrets', () => {
    const text = JSON.stringify(spec);
    for (const m of text.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)) assert.ok(spec.components.schemas[m[1]], `missing schema ${m[1]}`);
    assert.ok(!/ocrm_[A-Za-z0-9_-]{20,}/.test(text), 'no real keys');
    assert.ok(!text.includes(process.env.JWT_ACCESS_SECRET));
  });

  it('documents the webhook events people can subscribe to', async () => {
    const { EVENTS } = await import('../src/modules/outbound/webhook.model.js');
    assert.deepEqual(Object.keys(spec.webhooks).sort(), [...EVENTS].sort());
  });

  it('only describes endpoints that really exist', async () => {
    for (const { method, path } of operations()) {
      // Signed in: without credentials every route under a protected prefix answers 401, which would prove nothing.
      const res = await request(app)[method](`/api/v1${fill(path)}`).set(auth).send({});
      const missing = res.status === 404 && res.body?.error?.message === 'Route not found';
      assert.ok(!missing, `${method.toUpperCase()} ${path} is documented but there is no such route`);
    }
  });

  it('proves the check can fail: an invented path really is "Route not found"', async () => {
    const res = await request(app).get('/api/v1/dataforms/nothing/here/at/all').set(auth);
    assert.equal(res.body.error.message, 'Route not found');
  });

  it('documents every operation an API key may call, and labels them with the right scope', () => {
    const allowed = [
      ['get', '/workspaces', 'read'], ['get', '/workspaces/{id}', 'read'], ['get', '/dataforms', 'read'], ['get', '/dataforms/{id}', 'read'],
      ['get', '/dataforms/{id}/records', 'read'], ['get', '/dataforms/{id}/records/{recordId}', 'read'], ['get', '/dataforms/{id}/records/{recordId}/history', 'read'],
      ['post', '/dataforms/{id}/records/query', 'read'], ['post', '/dataforms/{id}/records/export', 'read'], ['post', '/dataforms/{id}/analyze', 'read'],
      ['post', '/dataforms/{id}/records', 'write'], ['patch', '/dataforms/{id}/records/{recordId}', 'write'], ['delete', '/dataforms/{id}/records/{recordId}', 'write'],
      ['post', '/dataforms/{id}/records/bulk', 'write'], ['post', '/dataforms/{id}/records/{recordId}/copy', 'write'], ['post', '/dataforms/{id}/records/{recordId}/move', 'write'],
    ];
    for (const [method, path, scope] of allowed) assert.equal(spec.paths[path]?.[method]?.['x-api-key-scope'], scope, `${method} ${path}`);
    const labelled = operations().filter((o) => o.op['x-api-key-scope']).length;
    assert.equal(labelled, allowed.length, 'nothing else is labelled as available to API keys');
  });

  it('marks administration endpoints as not available to API keys', () => {
    for (const { op } of operations().filter((o) => o.path.startsWith('/api-keys') || o.path.startsWith('/outbound-webhooks') || o.path === '/audit')) {
      assert.equal(op['x-api-key-scope'], undefined);
      assert.deepEqual(op.security, [{ bearerAuth: [] }]);
    }
  });
});

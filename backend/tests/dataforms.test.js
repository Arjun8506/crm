import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';

let mongod;
let app;
const tokens = {};
const as = (who) => ({ Authorization: `Bearer ${tokens[who]}` });
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set(as(who));
  return body === undefined ? r : r.send(body);
};

let wsId; let globexWsId;
let contacts; let companies;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
  for (const who of ['owner@acme.test', 'member@acme.test', 'viewer@acme.test', 'owner@globex.test']) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' });
    tokens[who] = res.body.accessToken;
  }
  wsId = (await api('post', 'owner@acme.test', '/workspaces', { name: 'Dataform test space' })).body.workspace._id;
  globexWsId = (await api('get', 'owner@globex.test', '/workspaces')).body.data[0]._id;
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const OWNER = 'owner@acme.test';
const MEMBER = 'member@acme.test';
const VIEWER = 'viewer@acme.test';
const GLOBEX = 'owner@globex.test';

describe('dataforms and fields', () => {
  it('creates dataforms from templates and lists them with counts', async () => {
    const co = await api('post', OWNER, '/dataforms', { workspaceId: wsId, name: 'Companies', templateId: 'companies' });
    assert.equal(co.status, 201);
    companies = co.body.dataform;
    assert.equal(companies.primaryField, 'name');
    const ct = await api('post', OWNER, '/dataforms', { workspaceId: wsId, name: 'Contacts', templateId: 'contacts' });
    contacts = ct.body.dataform;
    const list = (await api('get', OWNER, `/dataforms?workspaceId=${wsId}`)).body.data;
    assert.deepEqual(list.map((d) => d.name).sort(), ['Companies', 'Contacts']);
    assert.equal(list.find((d) => d.name === 'Contacts').fieldCount, 6);
  });

  it('validates field definitions', async () => {
    const f = (body) => api('post', OWNER, `/dataforms/${contacts._id}/fields`, body);
    assert.equal((await f({ key: 'Bad Key', label: 'x', type: 'text' })).status, 400);
    assert.equal((await f({ key: 'pick', label: 'Pick', type: 'dropdown' })).status, 400, 'dropdown needs options');
    assert.equal((await f({ key: 'name', label: 'Dup', type: 'text' })).status, 409, 'duplicate key');
    assert.equal((await f({ key: 'bio', label: 'Bio', type: 'textarea', unique: true })).status, 400, 'textarea cannot be unique');
    assert.equal((await f({ key: 'link', label: 'Link', type: 'relationship' })).status, 400, 'relationship needs a target');
    const rel = await f({ key: 'company', label: 'Company', type: 'relationship', config: { targetDataform: companies._id } });
    assert.equal(rel.status, 201);
  });

  it('rejects a relationship target in another workspace or tenant', async () => {
    const other = await api('post', GLOBEX, '/dataforms', { workspaceId: globexWsId, name: 'Their forms' });
    const res = await api('post', OWNER, `/dataforms/${contacts._id}/fields`, { key: 'x', label: 'X', type: 'relationship', config: { targetDataform: other.body.dataform._id } });
    assert.equal(res.status, 400);
  });

  it('enforces who can build dataforms', async () => {
    assert.equal((await api('post', MEMBER, '/dataforms', { workspaceId: wsId, name: 'Nope' })).status, 403);
    assert.equal((await api('post', VIEWER, '/dataforms', { workspaceId: wsId, name: 'Nope' })).status, 403);
    assert.equal((await api('post', GLOBEX, '/dataforms', { workspaceId: wsId, name: 'Cross tenant' })).status, 404);
    assert.equal((await api('get', GLOBEX, `/dataforms/${contacts._id}`)).status, 404);
  });

  it('reorders fields and requires every id', async () => {
    const { fields } = (await api('get', OWNER, `/dataforms/${contacts._id}`)).body;
    const ids = fields.map((x) => x._id);
    assert.equal((await api('put', OWNER, `/dataforms/${contacts._id}/fields/order`, { ids: ids.slice(1) })).status, 400);
    assert.equal((await api('put', OWNER, `/dataforms/${contacts._id}/fields/order`, { ids: [...ids].reverse() })).status, 200);
    const after = (await api('get', OWNER, `/dataforms/${contacts._id}`)).body.fields;
    assert.equal(after[0]._id, ids.at(-1));
  });
});

describe('records', () => {
  let acme;
  it('validates and creates records, applying defaults', async () => {
    const co = await api('post', MEMBER, `/dataforms/${companies._id}/records`, { data: { name: 'Acme Corp', employees: '120' } });
    assert.equal(co.status, 201);
    acme = co.body.record;
    assert.equal(acme.data.employees, 120);

    const bad = await api('post', MEMBER, `/dataforms/${contacts._id}/records`, { data: { email: 'nope', status: 'weird', mystery: 1 } });
    assert.equal(bad.status, 400);
    const paths = bad.body.error.details.map((d) => d.path);
    assert.ok(['data.name', 'data.email', 'data.status', 'data.mystery'].every((p) => paths.includes(p)), paths.join());

    const ok = await api('post', MEMBER, `/dataforms/${contacts._id}/records`, { data: { name: 'Ada Lovelace', email: 'ADA@Example.com', company: acme._id, tags: ['vip', 'vip'] } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.record.data.status, 'lead', 'default applied');
    assert.equal(ok.body.record.data.email, 'ada@example.com');
    assert.deepEqual(ok.body.record.data.tags, ['vip']);
    assert.equal(ok.body.refs.company[acme._id], 'Acme Corp');
  });

  it('enforces uniqueness and relationship validity', async () => {
    const dup = await api('post', MEMBER, `/dataforms/${contacts._id}/records`, { data: { name: 'Ada 2', email: 'ada@example.com' } });
    assert.equal(dup.status, 400);
    const ghost = await api('post', MEMBER, `/dataforms/${contacts._id}/records`, { data: { name: 'Ghost', company: new mongoose.Types.ObjectId().toString() } });
    assert.equal(ghost.status, 400);
    // a record id from another tenant is never accepted as a relationship value
    const gf = (await api('post', GLOBEX, '/dataforms', { workspaceId: globexWsId, name: 'Globex people', templateId: 'companies' })).body.dataform;
    const theirRecord = (await api('post', GLOBEX, `/dataforms/${gf._id}/records`, { data: { name: 'Their Co' } })).body.record;
    const cross = await api('post', MEMBER, `/dataforms/${contacts._id}/records`, { data: { name: 'Cross', company: theirRecord._id } });
    assert.equal(cross.status, 400);
  });

  it('keeps viewers read-only and blocks cross-tenant access', async () => {
    assert.equal((await api('post', VIEWER, `/dataforms/${companies._id}/records`, { data: { name: 'Viewer made' } })).status, 403);
    assert.equal((await api('post', VIEWER, `/dataforms/${companies._id}/records/query`, {})).status, 200);
    assert.equal((await api('post', GLOBEX, `/dataforms/${companies._id}/records/query`, {})).status, 404);
    assert.equal((await api('get', GLOBEX, `/dataforms/${companies._id}/records/${acme._id}`)).status, 404);
  });

  it('records history on update and ignores no-op saves', async () => {
    const upd = await api('patch', MEMBER, `/dataforms/${companies._id}/records/${acme._id}`, { data: { employees: 150, industry: 'technology' } });
    assert.equal(upd.status, 200);
    await api('patch', MEMBER, `/dataforms/${companies._id}/records/${acme._id}`, { data: { employees: 150 } });
    const history = (await api('get', MEMBER, `/dataforms/${companies._id}/records/${acme._id}/history`)).body.data;
    assert.deepEqual(history.map((h) => h.action), ['update', 'create']);
    const emp = history[0].changes.find((c) => c.field === 'employees');
    assert.deepEqual([emp.from, emp.to], [120, 150]);
  });

  it('copies records without unique fields', async () => {
    const list = (await api('post', MEMBER, `/dataforms/${contacts._id}/records/query`, {})).body.data;
    const copy = await api('post', MEMBER, `/dataforms/${contacts._id}/records/${list[0]._id}/copy`);
    assert.equal(copy.status, 201);
    assert.equal(copy.body.record.data.email, undefined);
    assert.equal(copy.body.record.data.name, 'Ada Lovelace');
  });
});

describe('querying', () => {
  before(async () => {
    const rows = [
      { name: 'Grace Hopper', email: 'grace@navy.mil', status: 'customer', last_contacted: '2026-01-10', tags: ['partner'] },
      { name: 'Alan Turing', email: 'alan@bletchley.uk', status: 'prospect', last_contacted: '2026-03-05', tags: ['vip', 'event'] },
      { name: 'Linus (the) Dev [1]', status: 'lead' },
      { name: 'Margaret Hamilton', email: 'mh@nasa.gov', status: 'customer', last_contacted: '2026-02-20' },
    ];
    for (const data of rows) await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data }).expect(201);
  });

  const q = async (body) => (await api('post', OWNER, `/dataforms/${contacts._id}/records/query`, body));
  const names = (res) => res.body.data.map((r) => r.data.name);
  const cond = (field, operator, value) => ({ field, operator, value });

  it('searches, sorts and paginates on the server', async () => {
    const search = await q({ q: 'turing' });
    assert.deepEqual(names(search), ['Alan Turing']);
    const sorted = await q({ sort: 'name:asc', limit: 2, page: 2 });
    assert.equal(sorted.body.limit, 2);
    assert.ok(sorted.body.total >= 6);
    assert.deepEqual(names(sorted), [...names(sorted)].sort());
    assert.equal((await q({ sort: 'passwordHash:asc' })).status, 400);
  });

  it('supports AND / OR / nested groups', async () => {
    const and = await q({ filter: { op: 'and', conditions: [cond('status', 'eq', 'customer'), cond('last_contacted', 'gte', '2026-02-01')] } });
    assert.deepEqual(names(and), ['Margaret Hamilton']);
    const or = await q({ sort: 'name:asc', filter: { op: 'or', conditions: [cond('name', 'startsWith', 'gra'), cond('tags', 'contains', ['vip'])] } });
    assert.ok(names(or).includes('Grace Hopper') && names(or).includes('Alan Turing') && names(or).includes('Ada Lovelace'));
    const nested = await q({ filter: { op: 'and', conditions: [cond('status', 'eq', 'customer'), { op: 'or', conditions: [cond('name', 'contains', 'grace'), cond('name', 'contains', 'margaret')] }] } });
    assert.equal(nested.body.total, 2);
  });

  it('handles empty / not-empty, between and relative dates', async () => {
    const noEmail = names(await q({ filter: { op: 'and', conditions: [cond('email', 'empty')] } }));
    assert.ok(noEmail.includes('Linus (the) Dev [1]') && !noEmail.includes('Grace Hopper'));
    const notEmpty = await q({ filter: { op: 'and', conditions: [cond('last_contacted', 'notEmpty')] } });
    assert.equal(notEmpty.body.total, 3);
    const between = await q({ filter: { op: 'and', conditions: [cond('last_contacted', 'between', ['2026-01-01', '2026-02-28'])] } });
    assert.equal(between.body.total, 2);
    assert.equal((await q({ filter: { op: 'and', conditions: [cond('last_contacted', 'inLastDays', 3650)] } })).body.total, 3);
    assert.equal((await q({ filter: { op: 'and', conditions: [cond('last_contacted', 'inNextDays', 1)] } })).body.total, 0);
  });

  it('escapes regex input and rejects unsafe filters', async () => {
    assert.deepEqual(names(await q({ filter: { op: 'and', conditions: [cond('name', 'contains', '(the) Dev [1]')] } })), ['Linus (the) Dev [1]']);
    assert.equal((await q({ filter: { op: 'and', conditions: [cond('name', 'contains', '.*')] } })).body.total, 0);
    assert.equal((await q({ filter: { op: 'and', conditions: [cond('$where', 'eq', '1')] } })).status, 400);
    assert.equal((await q({ filter: { op: 'and', conditions: [cond('name', 'gt', 'a')] } })).status, 400, 'operator not valid for text');
    assert.equal((await q({ filter: { op: 'and', conditions: [cond('name', 'eq', { $ne: null })] } })).status, 400);
    assert.equal((await q({ filter: { op: 'and', conditions: [cond('status', 'eq', 'not-an-option')] } })).status, 400);
    let deep = { op: 'and', conditions: [cond('name', 'eq', 'x')] };
    for (let i = 0; i < 5; i++) deep = { op: 'and', conditions: [deep] };
    assert.equal((await q({ filter: deep })).status, 400, 'too deeply nested');
  });

  it('filters on relationship fields', async () => {
    const co = (await api('post', OWNER, `/dataforms/${companies._id}/records/query`, { q: 'acme' })).body.data[0];
    const res = await q({ filter: { op: 'and', conditions: [cond('company', 'eq', co._id)] } });
    assert.equal(res.body.total, 2, 'Ada and her copy');
    assert.equal(res.body.refs.company[co._id], 'Acme Corp');
  });
});

describe('bulk operations, field changes and cleanup', () => {
  it('bulk updates and deletes with limits', async () => {
    const all = (await api('post', OWNER, `/dataforms/${contacts._id}/records/query`, { filter: { op: 'and', conditions: [{ field: 'status', operator: 'eq', value: 'customer' }] } })).body.data;
    const ids = all.map((r) => r._id);
    const upd = await api('post', OWNER, `/dataforms/${contacts._id}/records/bulk`, { action: 'update', ids, data: { status: 'churned' } });
    assert.equal(upd.body.affected, ids.length);
    const uniq = await api('post', OWNER, `/dataforms/${contacts._id}/records/bulk`, { action: 'update', ids, data: { email: 'same@x.com' } });
    assert.equal(uniq.status, 409);
    assert.equal((await api('post', VIEWER, `/dataforms/${contacts._id}/records/bulk`, { action: 'delete', ids })).status, 403);
    const del = await api('post', OWNER, `/dataforms/${contacts._id}/records/bulk`, { action: 'delete', ids });
    assert.equal(del.body.affected, ids.length);
    const many = Array.from({ length: 201 }, () => new mongoose.Types.ObjectId().toString());
    assert.equal((await api('post', OWNER, `/dataforms/${contacts._id}/records/bulk`, { action: 'delete', ids: many })).status, 400);
  });

  it('clears relationship values when the target record is deleted', async () => {
    const co = (await api('post', OWNER, `/dataforms/${companies._id}/records`, { data: { name: 'Temp Co' } })).body.record;
    const c = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Linked', company: co._id } })).body.record;
    await api('delete', OWNER, `/dataforms/${companies._id}/records/${co._id}`).expect(204);
    const after = (await api('get', OWNER, `/dataforms/${contacts._id}/records/${c._id}`)).body.record;
    assert.equal(after.data.company, undefined);
  });

  it('hides list-hidden fields from lists and strips deleted fields from records', async () => {
    const { fields } = (await api('get', OWNER, `/dataforms/${contacts._id}`)).body;
    const phone = fields.find((f) => f.key === 'phone');
    await api('patch', OWNER, `/dataforms/${contacts._id}/fields/${phone._id}`, { visibility: { list: false } }).expect(200);
    const r = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Phone Person', phone: '+1 555 123 4567' } })).body.record;
    const listed = (await api('post', OWNER, `/dataforms/${contacts._id}/records/query`, { q: 'Phone Person' })).body.data[0];
    assert.equal(listed.data.phone, undefined);
    assert.equal((await api('get', OWNER, `/dataforms/${contacts._id}/records/${r._id}`)).body.record.data.phone, '+1 555 123 4567');
    await api('delete', OWNER, `/dataforms/${contacts._id}/fields/${phone._id}`).expect(204);
    assert.equal((await api('get', OWNER, `/dataforms/${contacts._id}/records/${r._id}`)).body.record.data.phone, undefined);
  });

  it('protects referenced dataforms, blocks writes when archived, and clones', async () => {
    assert.equal((await api('delete', OWNER, `/dataforms/${companies._id}`)).status, 409);
    const clone = await api('post', OWNER, `/dataforms/${contacts._id}/clone`);
    assert.equal(clone.status, 201);
    assert.equal((await api('get', OWNER, `/dataforms/${clone.body.dataform._id}`)).body.fields.length, 6);
    await api('delete', OWNER, `/dataforms/${clone.body.dataform._id}`).expect(204);
    await api('patch', OWNER, `/dataforms/${companies._id}`, { status: 'archived' }).expect(200);
    assert.equal((await api('post', OWNER, `/dataforms/${companies._id}/records`, { data: { name: 'Late' } })).status, 409);
  });
});

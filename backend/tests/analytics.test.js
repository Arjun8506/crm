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
const OWNER = 'owner@acme.test';
const ADMIN = 'admin@acme.test';
const MEMBER = 'member@acme.test';
const VIEWER = 'viewer@acme.test';
const GLOBEX = 'owner@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};

let deals; let contacts; let companies; let salesWs;
const cond = (field, operator, value) => ({ field, operator, value });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
  for (const who of [OWNER, ADMIN, MEMBER, VIEWER, GLOBEX]) {
    tokens[who] = (await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' })).body.accessToken;
  }
  const workspaces = (await api('get', OWNER, '/workspaces')).body.data;
  salesWs = workspaces.find((w) => w.name === 'Sales Pipeline');
  const forms = (await api('get', OWNER, `/dataforms?workspaceId=${salesWs._id}`)).body.data;
  deals = forms.find((f) => f.name === 'Deals');
  contacts = forms.find((f) => f.name === 'Contacts');
  companies = forms.find((f) => f.name === 'Companies');
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('location fields and entitlements', () => {
  it('stores validated coordinates and gates the field type by plan', async () => {
    const hq = (await api('get', OWNER, `/dataforms/${companies._id}`)).body.fields.find((f) => f.type === 'location');
    assert.ok(hq, 'seeded location field');
    const ok = await api('post', OWNER, `/dataforms/${companies._id}/records`, { data: { name: 'Geo Co', hq: { lat: '51.5', lng: -0.12 } } });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.record.data.hq, { lat: 51.5, lng: -0.12 });
    for (const bad of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 'x', lng: 1 }, 'nowhere']) {
      assert.equal((await api('post', OWNER, `/dataforms/${companies._id}/records`, { data: { name: 'Bad Geo', hq: bad } })).status, 400);
    }
    const gws = (await api('get', GLOBEX, '/workspaces')).body.data[0];
    const gform = (await api('post', GLOBEX, '/dataforms', { workspaceId: gws._id, name: 'Sites' })).body.dataform;
    const denied = await api('post', GLOBEX, `/dataforms/${gform._id}/fields`, { key: 'where', label: 'Where', type: 'location' });
    assert.equal(denied.status, 402, 'free plan has no location fields');
    assert.equal(denied.body.error.code, 'PLAN_LIMIT');
  });
});

describe('kanban moves', () => {
  let ids;
  before(async () => {
    const res = await api('post', OWNER, `/dataforms/${deals._id}/records/query`, { filter: { op: 'and', conditions: [cond('stage', 'eq', 'qualified')] }, sort: 'rank:asc', limit: 5 });
    ids = res.body.data.map((r) => r._id);
    assert.ok(ids.length >= 3);
  });

  it('changes stage and persists the card position', async () => {
    const [a, b, c] = ids;
    // move the last card between the first two, and into another stage
    const moved = await api('post', MEMBER, `/dataforms/${deals._id}/records/${c}/move`, { field: 'stage', value: 'proposal', afterId: a, beforeId: b });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.record.data.stage, 'proposal');
    const rankA = (await api('get', OWNER, `/dataforms/${deals._id}/records/${a}`)).body.record.rank;
    const rankB = (await api('get', OWNER, `/dataforms/${deals._id}/records/${b}`)).body.record.rank;
    assert.ok(moved.body.record.rank > Math.min(rankA, rankB) && moved.body.record.rank < Math.max(rankA, rankB));
    const history = (await api('get', OWNER, `/dataforms/${deals._id}/records/${c}/history`)).body.data;
    assert.equal(history[0].changes[0].field, 'stage');
  });

  it('rejects invalid stages, wrong fields and viewers', async () => {
    const id = ids[0];
    assert.equal((await api('post', OWNER, `/dataforms/${deals._id}/records/${id}/move`, { field: 'stage', value: 'nope' })).status, 400);
    assert.equal((await api('post', OWNER, `/dataforms/${deals._id}/records/${id}/move`, { field: 'title', value: 'x' })).status, 400);
    assert.equal((await api('post', VIEWER, `/dataforms/${deals._id}/records/${id}/move`, { field: 'stage', value: 'won' })).status, 403);
    assert.equal((await api('post', GLOBEX, `/dataforms/${deals._id}/records/${id}/move`, { field: 'stage', value: 'won' })).status, 404);
  });
});

describe('saved views', () => {
  let personal; let shared;
  const config = { filter: { op: 'and', conditions: [cond('stage', 'eq', 'won')] }, sort: 'value:desc' };

  it('creates personal and shared views with the right visibility', async () => {
    personal = (await api('post', MEMBER, `/dataforms/${deals._id}/views`, { name: 'My won deals', type: 'table', config })).body.view;
    assert.ok(personal._id);
    assert.equal((await api('post', VIEWER, `/dataforms/${deals._id}/views`, { name: 'x', type: 'table', shared: true, config: {} })).status, 403, 'viewers cannot share');
    shared = (await api('post', MEMBER, `/dataforms/${deals._id}/views`, { name: 'Team won deals', type: 'cards', shared: true, config })).body.view;
    const names = async (who) => (await api('get', who, `/dataforms/${deals._id}/views`)).body.data.map((v) => v.name);
    assert.ok((await names(MEMBER)).includes('My won deals'));
    assert.ok(!(await names(OWNER)).includes('My won deals'), 'personal view is private');
    assert.ok((await names(OWNER)).includes('Team won deals'));
    assert.ok((await names(VIEWER)).includes('Deal pipeline'), 'seeded shared view');
  });

  it('validates configs and limits who can change views', async () => {
    assert.equal((await api('post', MEMBER, `/dataforms/${deals._id}/views`, { name: 'bad', type: 'table', config: { filter: { op: 'and', conditions: [cond('ghost', 'eq', 1)] } } })).status, 400);
    assert.equal((await api('post', MEMBER, `/dataforms/${deals._id}/views`, { name: 'bad', type: 'pie', config: {} })).status, 400);
    assert.equal((await api('delete', VIEWER, `/dataforms/${deals._id}/views/${shared._id}`)).status, 403);
    assert.equal((await api('delete', VIEWER, `/dataforms/${deals._id}/views/${personal._id}`)).status, 404);
    assert.equal((await api('delete', GLOBEX, `/dataforms/${deals._id}/views`)).status, 404);
    assert.equal((await api('delete', OWNER, `/dataforms/${deals._id}/views/${shared._id}`)).status, 204, 'workspace admin may curate shared views');
    assert.equal((await api('delete', MEMBER, `/dataforms/${deals._id}/views/${personal._id}`)).status, 204);
  });
});

describe('grouped table analyzer', () => {
  const analyze = (who, body, df = deals) => api('post', who, `/dataforms/${df._id}/analyze`, body);

  it('groups, aggregates and totals consistently with the record list', async () => {
    const total = (await api('post', OWNER, `/dataforms/${deals._id}/records/query`, {})).body.total;
    const res = await analyze(OWNER, { groupBy: [{ field: 'stage' }], metrics: [{ op: 'count' }, { op: 'sum', field: 'value' }, { op: 'avg', field: 'value' }, { op: 'min', field: 'value' }, { op: 'max', field: 'value' }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rows.reduce((n, r) => n + r.metrics.m0, 0), total);
    assert.equal(res.body.totals.m0, total);
    assert.ok(res.body.rows.every((r) => r.metrics.m3 <= r.metrics.m4 && r.metrics.m3 <= r.metrics.m2));
    const sum = res.body.rows.reduce((n, r) => n + r.metrics.m1, 0);
    assert.equal(Math.round(res.body.totals.m1), Math.round(sum));
  });

  it('drill-down filters return exactly the grouped records', async () => {
    const res = await analyze(OWNER, { groupBy: [{ field: 'stage' }, { field: 'close_date', interval: 'quarter' }], metrics: [{ op: 'count' }] });
    assert.ok(res.body.rows.length > 2);
    for (const row of res.body.rows.slice(0, 6)) {
      const drilled = await api('post', OWNER, `/dataforms/${deals._id}/records/query`, { filter: row.drill });
      assert.equal(drilled.status, 200, JSON.stringify(drilled.body));
      assert.equal(drilled.body.total, row.metrics.m0, `drill mismatch for ${JSON.stringify(row.keys)}`);
    }
  });

  it('buckets dates by interval, groups by relationship, and paginates groups', async () => {
    for (const interval of ['day', 'week', 'month', 'quarter', 'year']) {
      const r = await analyze(OWNER, { groupBy: [{ field: 'close_date', interval }], metrics: [{ op: 'count' }] });
      assert.equal(r.status, 200, interval);
      assert.equal(r.body.rows.reduce((n, x) => n + x.metrics.m0, 0), r.body.totals.m0);
    }
    const byCompany = await analyze(OWNER, { groupBy: [{ field: 'company' }], metrics: [{ op: 'count' }], limit: 5 });
    assert.equal(byCompany.body.rows.length, 5);
    assert.ok(byCompany.body.total > 5);
    const labelled = byCompany.body.rows.filter((r) => r.keys[0]).every((r) => byCompany.body.refs.company[r.keys[0]]);
    assert.ok(labelled, 'relationship labels resolved');
    const page2 = await analyze(OWNER, { groupBy: [{ field: 'company' }], metrics: [{ op: 'count' }], limit: 5, page: 2 });
    assert.notDeepEqual(page2.body.rows[0].keys, byCompany.body.rows[0].keys);
    const created = await analyze(OWNER, { groupBy: [{ field: 'createdAt', interval: 'year' }], metrics: [{ op: 'count' }] });
    assert.equal(created.status, 200);
  });

  it('applies filters and rejects invalid requests', async () => {
    const won = await analyze(OWNER, { groupBy: [{ field: 'stage' }], filter: { op: 'and', conditions: [cond('stage', 'eq', 'won')] } });
    assert.equal(won.body.rows.length, 1);
    assert.equal((await analyze(OWNER, { groupBy: [{ field: 'ghost' }] })).status, 400);
    assert.equal((await analyze(OWNER, { groupBy: [{ field: 'value' }] })).status, 400, 'decimal is not groupable');
    assert.equal((await analyze(OWNER, { groupBy: [{ field: 'stage' }], metrics: [{ op: 'sum', field: 'title' }] })).status, 400);
    assert.equal((await analyze(OWNER, { groupBy: [{ field: 'stage' }, { field: 'stage' }, { field: 'stage' }, { field: 'stage' }] })).status, 400);
    assert.equal((await analyze(OWNER, { metrics: [{ op: 'sum' }] })).status, 400);
    assert.equal((await analyze(GLOBEX, { groupBy: [{ field: 'stage' }] })).status, 404, 'tenant isolation');
    const multi = await analyze(OWNER, { groupBy: [{ field: 'tags' }], metrics: [{ op: 'count' }] }, contacts);
    assert.equal(multi.status, 200, 'multiselect groups per tag');
  });
});

describe('reports', () => {
  let report;
  it('saves list and analyzer reports with sharing rules', async () => {
    const list = await api('post', MEMBER, '/reports', { dataformId: deals._id, name: 'Big deals', kind: 'list', config: { columns: ['title', 'value'], sort: 'value:desc', filter: { op: 'and', conditions: [cond('value', 'gte', 50000)] } } });
    assert.equal(list.status, 201, JSON.stringify(list.body));
    report = list.body.report;
    const names = async (who) => (await api('get', who, `/reports?workspaceId=${salesWs._id}`)).body.data.map((r) => r.name);
    assert.ok((await names(MEMBER)).includes('Big deals'));
    assert.ok(!(await names(OWNER)).includes('Big deals'), 'personal report is private');
    assert.ok((await names(VIEWER)).includes('Pipeline value by stage'), 'seeded shared report');
    assert.equal((await api('post', VIEWER, '/reports', { dataformId: deals._id, name: 's', kind: 'list', shared: true, config: {} })).status, 403);
    assert.equal((await api('get', OWNER, `/reports/${report._id}`)).status, 404);
    assert.equal((await api('patch', MEMBER, `/reports/${report._id}`, { name: 'Big deals!', config: report.config, shared: true })).status, 200);
    assert.equal((await api('get', OWNER, `/reports/${report._id}`)).status, 200, 'now shared');
    assert.equal((await api('delete', VIEWER, `/reports/${report._id}`)).status, 403);
  });

  it('validates configuration and workspace access', async () => {
    assert.equal((await api('post', MEMBER, '/reports', { dataformId: deals._id, name: 'x', kind: 'list', config: { filter: { op: 'and', conditions: [cond('ghost', 'eq', 1)] } } })).status, 400);
    assert.equal((await api('post', MEMBER, '/reports', { dataformId: deals._id, name: 'x', kind: 'analyzer', config: { groupBy: 'stage' } })).status, 400);
    assert.equal((await api('post', GLOBEX, '/reports', { dataformId: deals._id, name: 'x', kind: 'list', config: {} })).status, 404);
    assert.equal((await api('get', GLOBEX, `/reports?workspaceId=${salesWs._id}`)).status, 404);
    assert.equal((await api('delete', MEMBER, `/reports/${report._id}`)).status, 204);
  });
});

describe('dashboards', () => {
  let dash;
  it('lists the seeded account dashboard and computes every widget type', async () => {
    const list = (await api('get', VIEWER, '/dashboards')).body.data;
    const sales = list.find((d) => d.name === 'Sales overview');
    assert.ok(sales);
    assert.equal(sales.editable, false);
    dash = (await api('get', VIEWER, `/dashboards/${sales._id}`)).body.dashboard;
    const data = {};
    for (const w of dash.widgets) {
      const r = await api('post', VIEWER, `/dashboards/${dash._id}/widgets/${w.id}/data`);
      assert.equal(r.status, 200, `${w.title}: ${JSON.stringify(r.body)}`);
      data[w.title] = r.body;
    }
    const total = (await api('post', OWNER, `/dataforms/${contacts._id}/records/query`, {})).body.total;
    assert.equal(data.Contacts.value, total);
    assert.equal(data['Deal value by stage'].rows.length > 0, true);
    assert.equal(data['Newest contacts'].rows.length, 6);
    assert.equal(data['Largest open deals'].type, 'list');
  });

  it('restricts editing and keeps personal dashboards private', async () => {
    assert.equal((await api('post', MEMBER, '/dashboards', { name: 'Co-wide', scope: 'account', widgets: [] })).status, 403);
    assert.equal((await api('put', VIEWER, `/dashboards/${dash._id}`, { name: 'hijack', widgets: [] })).status, 403);
    assert.equal((await api('delete', MEMBER, `/dashboards/${dash._id}`)).status, 403);
    const mine = (await api('post', MEMBER, '/dashboards', {
      name: 'Mine', scope: 'user', widgets: [{ type: 'kpi', title: 'Deals', config: { dataformId: deals._id, metric: { op: 'count' } } }],
    })).body.dashboard;
    assert.ok(mine.widgets[0].id, 'widget ids are assigned by the server');
    assert.equal((await api('get', OWNER, `/dashboards/${mine._id}`)).status, 404);
    assert.equal((await api('post', OWNER, `/dashboards/${mine._id}/widgets/${mine.widgets[0].id}/data`)).status, 404);
    assert.equal((await api('get', GLOBEX, `/dashboards/${dash._id}`)).status, 404);
    assert.equal((await api('put', MEMBER, `/dashboards/${mine._id}`, { name: 'Mine 2', widgets: [{ type: 'script', title: 'x', config: {} }] })).status, 400);
    assert.equal((await api('delete', MEMBER, `/dashboards/${mine._id}`)).status, 204);
  });

  it('never leaks data from workspaces the viewer cannot open', async () => {
    const privateWs = (await api('get', OWNER, '/workspaces')).body.data.find((w) => w.name === 'Executive Planning');
    const secret = (await api('post', OWNER, '/dataforms', { workspaceId: privateWs._id, name: 'Board notes', templateId: 'tickets' })).body.dataform;
    await api('post', OWNER, `/dataforms/${secret._id}/records`, { data: { subject: 'Confidential' } }).expect(201);
    const mine = (await api('post', MEMBER, '/dashboards', {
      name: 'Sneaky', scope: 'user', widgets: [{ type: 'list', title: 'Secrets', config: { dataformId: secret._id } }],
    })).body.dashboard;
    const res = await api('post', MEMBER, `/dashboards/${mine._id}/widgets/${mine.widgets[0].id}/data`);
    assert.equal(res.status, 404);
    const own = (await api('post', OWNER, '/dashboards', { name: 'Exec', scope: 'user', widgets: [{ type: 'list', title: 'Secrets', config: { dataformId: secret._id } }] })).body.dashboard;
    assert.equal((await api('post', OWNER, `/dashboards/${own._id}/widgets/${own.widgets[0].id}/data`)).status, 200);
  });
});

describe('csv export', () => {
  it('exports filtered rows, escapes formulas and respects hidden columns', async () => {
    await api('post', OWNER, `/dataforms/${companies._id}/records`, { data: { name: '=HYPERLINK("http://evil")', notes: 'a, "quoted"\nline' } }).expect(201);
    const fields = (await api('get', OWNER, `/dataforms/${companies._id}`)).body.fields;
    await api('patch', OWNER, `/dataforms/${companies._id}/fields/${fields.find((f) => f.key === 'notes')._id}`, { visibility: { list: false } }).expect(200);
    const res = await api('post', MEMBER, `/dataforms/${companies._id}/records/export`, { q: 'HYPERLINK' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    const lines = res.text.trim().split('\r\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith('Company name'));
    assert.ok(!lines[0].includes('Notes'), 'list-hidden field excluded');
    assert.ok(lines[1].startsWith('"\'=HYPERLINK(""http://evil"")"') || lines[1].startsWith("'=HYPERLINK"), lines[1]);
    const all = await api('post', OWNER, `/dataforms/${deals._id}/records/export`, { columns: ['title', 'company', 'stage'], sort: 'title:asc' });
    const rows = all.text.trim().split('\r\n');
    assert.equal(rows[0], 'Deal title,Company,Stage');
    assert.ok(rows.length > 20);
    assert.ok(!/[a-f0-9]{24}/.test(rows[1]), 'relationships exported as labels, not ids');
    assert.equal((await api('post', GLOBEX, `/dataforms/${deals._id}/records/export`, {})).status, 404);
  });
});

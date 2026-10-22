import './_env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let mongod; let app; let timing; let RecordModel; let RecordHistory; let Attachment; let PublicForm; let PublicShare; let hashToken;
const tokens = {}; const ids = {};
const OWNER = 'owner@acme.test'; const MEMBER = 'member@acme.test'; const GLOBEX = 'owner@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};
const anon = (method, url) => request(app)[method](`/api/v1/public${url}`);

let ws; let contacts; let deals; let companies;

const mkForm = (body, who = OWNER, dataform = contacts) => api('post', who, `/dataforms/${dataform._id}/forms`, { name: 'Contact us', fields: [{ key: 'name' }, { key: 'email' }], ...body });
const submit = async (form, data, extra = {}) => {
  const page = await anon('get', `/forms/${form.token}`);
  return anon('post', `/forms/${form.token}/submit`).send({ data, _t: page.body.formToken, ...extra });
};
const records = (dataform = contacts) => RecordModel.find({ dataform: dataform._id }).sort({ createdAt: 1 }).lean();

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ timing } = await import('../src/modules/publicforms/public.routes.js'));
  ({ RecordModel, RecordHistory } = await import('../src/modules/records/record.model.js'));
  ({ Attachment } = await import('../src/modules/attachments/attachment.model.js'));
  ({ PublicForm, PublicShare, hashToken } = await import('../src/modules/publicforms/public.models.js'));
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
  timing.minMs = 0;
  for (const who of [OWNER, MEMBER, GLOBEX]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' });
    tokens[who] = res.body.accessToken; ids[who] = res.body.user._id;
  }
  ws = (await api('post', OWNER, '/workspaces', { name: 'Public space' })).body.workspace;
  const mk = async (name, templateId) => (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name, templateId })).body.dataform;
  contacts = await mk('Leads', 'contacts'); deals = await mk('Deals', 'deals'); companies = await mk('Orgs', 'companies');
  await api('post', OWNER, `/dataforms/${deals._id}/fields`, { key: 'company', label: 'Company', type: 'relationship', config: { targetDataform: companies._id } }).expect(201);
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('building a public form', () => {
  it('is for workspace admins, signed in as people', async () => {
    assert.equal((await api('get', MEMBER, `/dataforms/${contacts._id}/forms`)).status, 403);
    assert.equal((await mkForm({}, MEMBER)).status, 403);
    assert.equal((await mkForm({}, GLOBEX)).status, 404);
    assert.equal((await request(app).get(`/api/v1/dataforms/${contacts._id}/forms`)).status, 401);
  });

  it('only offers fields a visitor can fill in, and requires the ones the record needs', async () => {
    assert.match((await mkForm({ fields: [{ key: 'email' }] })).body.error.message, /"Full name" is required/);
    assert.equal((await mkForm({ fields: [{ key: 'name' }, { key: 'ghost' }] })).status, 400);
    assert.equal((await mkForm({ fields: [{ key: 'name' }, { key: 'name' }] })).status, 400, 'listed twice');
    assert.equal((await mkForm({ fields: [] })).status, 400);
    assert.equal((await mkForm({ fields: [{ key: 'title' }, { key: 'company' }] }, OWNER, deals)).status, 400, 'links to other records are never public');
    assert.equal((await mkForm({ notifyUsers: [ids[GLOBEX]] })).status, 400);
    assert.equal((await mkForm({ opensAt: '2030-01-02T00:00:00Z', closesAt: '2030-01-01T00:00:00Z' })).status, 400);
    const list = (await api('get', OWNER, `/dataforms/${deals._id}/forms`)).body;
    assert.ok(!list.usableFields.some((f) => f.key === 'company'));
  });

  it('gets an unguessable link and can be paused, edited and relinked', async () => {
    const res = await mkForm({ name: 'Newsletter', description: 'Join us', notifyUsers: [ids[MEMBER]], fields: [{ key: 'name', label: 'Your name' }, { key: 'email', required: true }, { key: 'tags', helpText: 'Pick any' }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const form = res.body.form;
    assert.ok(form.token.length >= 40);
    assert.equal(form.url, `${process.env.APP_URL ?? 'http://localhost:5173'}/f/${form.token}`.replace(/\/\/f/, '/f'));
    const dup = (await mkForm({ name: 'Other' })).body.form;
    assert.notEqual(dup.token, form.token);
    const upd = await api('patch', OWNER, `/dataforms/${contacts._id}/forms/${form._id}`, { description: 'Join our list' });
    assert.equal(upd.body.form.description, 'Join our list');
    assert.equal((await api('patch', GLOBEX, `/dataforms/${contacts._id}/forms/${form._id}`, { enabled: false })).status, 404);
    const re = (await api('post', OWNER, `/dataforms/${contacts._id}/forms/${dup._id}/regenerate-link`)).body.form;
    assert.notEqual(re.token, dup.token);
    assert.equal((await anon('get', `/forms/${dup.token}`)).status, 404, 'the old link stops working');
    assert.equal((await anon('get', `/forms/${re.token}`)).status, 200);
    await api('delete', OWNER, `/dataforms/${contacts._id}/forms/${dup._id}`).expect(204);
    assert.equal((await anon('get', `/forms/${re.token}`)).status, 404);
  });
});

describe('what a visitor sees', () => {
  let form;
  before(async () => {
    form = (await mkForm({ name: 'Visible', description: 'Hello', fields: [{ key: 'name', label: 'Your name' }, { key: 'email', required: true }, { key: 'status' }] })).body.form;
  });

  it('shows only the chosen fields, without any internal ids, and needs no sign-in', async () => {
    const res = await anon('get', `/forms/${form.token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.form.fields.map((f) => f.key), ['name', 'email', 'status']);
    assert.equal(res.body.form.fields[0].label, 'Your name');
    assert.equal(res.body.form.fields[1].required, true);
    assert.ok(res.body.form.fields[2].options.some((o) => o.label === 'Customer'));
    assert.ok(!/[a-f0-9]{24}/.test(JSON.stringify(res.body)), 'no database ids leak');
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    assert.match(res.headers['cache-control'], /no-store/);
    assert.ok(res.body.formToken);
  });

  it('answers the same way for links that never existed', async () => {
    const a = await anon('get', '/forms/' + 'x'.repeat(43));
    const b = await anon('get', '/forms/short');
    assert.equal(a.status, 404);
    assert.deepEqual(a.body, b.body);
    assert.equal((await anon('post', '/forms/' + 'x'.repeat(43) + '/submit').send({ data: {} })).status, 404);
  });

  it('is closed when paused, before it opens, and after it closes', async () => {
    const url = `/dataforms/${contacts._id}/forms/${form._id}`;
    await api('patch', OWNER, url, { enabled: false }).expect(200);
    assert.equal((await anon('get', `/forms/${form.token}`)).status, 410);
    assert.equal((await submit(form, { name: 'x', email: 'x@y.test' })).status, 410);
    await api('patch', OWNER, url, { enabled: true, opensAt: new Date(Date.now() + 3600e3).toISOString() }).expect(200);
    assert.match((await anon('get', `/forms/${form.token}`)).body.error.message, /not open yet/);
    await api('patch', OWNER, url, { opensAt: null, closesAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
    assert.match((await anon('get', `/forms/${form.token}`)).body.error.message, /closed/);
    await api('patch', OWNER, url, { opensAt: new Date(Date.now() + 7200e3).toISOString(), closesAt: new Date(Date.now() + 3600e3).toISOString() }).expect(400);
    await api('patch', OWNER, url, { opensAt: null, closesAt: null }).expect(200);
    assert.equal((await anon('get', `/forms/${form.token}`)).status, 200);
  });
});

describe('submitting a form', () => {
  let form;
  before(async () => {
    form = (await mkForm({ name: 'Signup', successMessage: 'Welcome aboard!', notifyUsers: [ids[MEMBER]], fields: [{ key: 'name' }, { key: 'email', required: true }, { key: 'tags' }, { key: 'status' }] })).body.form;
  });

  it('creates the record and says nothing else about it', async () => {
    const res = await submit(form, { name: 'Visitor One', email: 'Visitor@Site.test', tags: ['vip'] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { ok: true, message: 'Welcome aboard!' });
    const rec = (await records()).find((r) => r.data.name === 'Visitor One');
    assert.deepEqual(rec.data, { name: 'Visitor One', email: 'visitor@site.test', tags: ['vip'], status: 'lead' }, 'validated like any other record, defaults applied');
    assert.equal(rec.createdBy, undefined, 'created by nobody signed in');
    const h = await RecordHistory.findOne({ record: rec._id });
    assert.equal(h.source, 'form:Signup');
    const hist = (await api('get', OWNER, `/dataforms/${contacts._id}/records/${rec._id}/history`)).body.data;
    assert.equal(hist[0].source, 'form:Signup');
    const note = (await api('get', MEMBER, '/notifications?limit=10')).body.data.find((n) => n.type === 'form_submission');
    assert.equal(note.title, 'New response on “Signup”');
    assert.equal(note.body, 'Visitor One');
    assert.equal((await PublicForm.findById(form._id)).submissionCount, 1);
  });

  it('refuses anything outside the form: other fields, wrong values, missing required ones', async () => {
    const before = await RecordModel.countDocuments({ dataform: contacts._id });
    const bad = async (data, path) => {
      const res = await submit(form, data);
      assert.equal(res.status, 400, JSON.stringify(data));
      assert.ok(res.body.error.details.some((d) => d.path === `data.${path}`), JSON.stringify(res.body));
    };
    await bad({ email: 'a@b.test', phone: '+1 555 0100' }, 'phone');
    await bad({ email: 'a@b.test', last_contacted: '2024-01-01' }, 'last_contacted');
    await bad({ name: 'No email' }, 'email');
    await bad({ email: 'nope' }, 'email');
    await bad({ email: 'a@b.test', status: 'Hacked' }, 'status');
    await bad({ email: 'a@b.test', tags: ['nonsense'] }, 'tags');
    assert.equal((await submit(form, 'string')).status, 400);
    assert.equal((await submit(form, [1])).status, 400);
    assert.equal(await RecordModel.countDocuments({ dataform: contacts._id }), before);
    assert.equal((await PublicForm.findById(form._id)).submissionCount, 1, 'failed attempts do not use up the response limit');
  });

  it('does not reveal which values already exist', async () => {
    const res = await submit(form, { name: 'Impostor', email: 'visitor@site.test' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].message, 'This value is not available');
  });

  it('quietly drops bots that fill in the hidden field', async () => {
    const n = await RecordModel.countDocuments({ dataform: contacts._id });
    const res = await submit(form, { name: 'Bot', email: 'bot@spam.test' }, { _hp: 'http://spam' });
    assert.deepEqual(res.body, { ok: true, message: 'Welcome aboard!' }, 'the bot is told it worked');
    assert.equal(await RecordModel.countDocuments({ dataform: contacts._id }), n);
  });

  it('rejects submissions that are too fast, forged or stale', async () => {
    const page = (await anon('get', `/forms/${form.token}`)).body;
    const post = (t) => anon('post', `/forms/${form.token}/submit`).send({ data: { name: 'Timer', email: 'timing@x.test' }, _t: t });
    assert.equal((await post(undefined)).body.error.code, 'FORM_EXPIRED');
    assert.equal((await post('123.abc')).body.error.code, 'FORM_EXPIRED');
    const [ts] = page.formToken.split('.');
    assert.equal((await post(`${ts}.${'A'.repeat(43)}`)).body.error.code, 'FORM_EXPIRED', 'signature must match');
    timing.minMs = 60_000;
    assert.equal((await post(page.formToken)).body.error.code, 'FORM_EXPIRED', 'sent before a person could have filled it in');
    timing.minMs = 0; timing.maxMs = -1;
    assert.equal((await post(page.formToken)).body.error.code, 'FORM_EXPIRED', 'stale');
    timing.maxMs = 2 * 3600e3;
    const other = (await mkForm({ name: 'Other form' })).body.form;
    assert.equal((await anon('post', `/forms/${other.token}/submit`).send({ data: { name: 'A', email: 'swap@x.test' }, _t: page.formToken })).status, 400, 'a token from another form is no good');
    assert.equal((await post(page.formToken)).status, 200);
  });

  it('stops at the response limit, even for simultaneous submissions', async () => {
    const limited = (await mkForm({ name: 'Limited', maxSubmissions: 2 })).body.form;
    const page = (await anon('get', `/forms/${limited.token}`)).body;
    const send = (i) => anon('post', `/forms/${limited.token}/submit`).send({ data: { name: `Racer ${i}`, email: `racer${i}@x.test` }, _t: page.formToken });
    const results = await Promise.all([1, 2, 3, 4, 5].map(send));
    assert.equal(results.filter((r) => r.status === 200).length, 2);
    assert.equal(results.filter((r) => r.status === 410).length, 3);
    assert.equal(await RecordModel.countDocuments({ dataform: contacts._id, 'data.name': /^Racer/ }), 2);
    assert.equal((await anon('get', `/forms/${limited.token}`)).body.error.message, 'This form is no longer accepting responses.');
  });

  it('runs before-save rules, showing the visitor the rule\'s message', async () => {
    const rule = (await api('post', OWNER, '/workflows', {
      dataformId: contacts._id, name: 'No spam domains', description: '', trigger: { type: 'pre_save', events: ['create'] },
      conditions: { op: 'and', conditions: [{ kind: 'field', field: 'name', operator: 'contains', value: 'Spammer' }] },
      actions: [{ type: 'validation_error', message: 'We cannot accept that address.' }],
    })).body.workflow;
    await api('patch', OWNER, `/workflows/${rule._id}/enabled`, { enabled: true }).expect(200);
    const res = await submit(form, { name: 'Spammer', email: 'x@spam.test' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'We cannot accept that address.');
    assert.equal((await submit(form, { name: 'Fine', email: 'fine@ok.test' })).status, 200);
    await api('delete', OWNER, `/workflows/${rule._id}`).expect(204);
  });
});

describe('files on forms', () => {
  it('accepts attachments only when the form allows them, and screens them like any upload', async () => {
    const plain = (await mkForm({ name: 'No files' })).body.form;
    const withFiles = (await mkForm({ name: 'With files', allowFiles: true })).body.form;
    const send = async (f, files) => {
      const page = (await anon('get', `/forms/${f.token}`)).body;
      let r = anon('post', `/forms/${f.token}/submit`).field('_t', page.formToken).field('data', JSON.stringify({ name: 'Filer', email: `${Math.random()}@f.test` }));
      for (const [name, content] of files) r = r.attach('files', Buffer.from(content), { filename: name, contentType: 'text/plain' });
      return r;
    };
    assert.equal((await send(plain, [['a.txt', 'hi']])).status, 400);
    assert.equal((await send(withFiles, [['a.txt', 'hi'], ['evil.exe', 'MZ'], ['b.txt', 'there']])).status, 200);
    const rec = (await records()).filter((r) => r.data.name === 'Filer').at(-1);
    const files = await Attachment.find({ record: rec._id }).lean();
    assert.deepEqual(files.map((f) => f.filename).sort(), ['a.txt', 'b.txt'], 'the executable was left out');
    assert.equal(files[0].uploader, undefined);
    assert.equal((await send(withFiles, [['1.txt', 'a'], ['2.txt', 'b'], ['3.txt', 'c'], ['4.txt', 'd']])).status, 400, 'at most three files');
    const mine = await api('get', OWNER, `/dataforms/${contacts._id}/records/${rec._id}/attachments`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.length, 2);
  });
});

describe('sharing one record', () => {
  let rec; let share; let token;
  const base = () => `/dataforms/${contacts._id}/records/${rec._id}/shares`;

  before(async () => {
    rec = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Shared Sam', email: 'sam@share.test', phone: '+1 555 0100', status: 'customer' } })).body.record;
  });

  it('is limited to editors and to fields that may be shown', async () => {
    assert.equal((await api('post', GLOBEX, base(), { fields: ['name'] })).status, 404);
    assert.equal((await api('post', OWNER, base(), { fields: [] })).status, 400);
    assert.equal((await api('post', OWNER, base(), { fields: ['ghost'] })).status, 400);
    assert.equal((await api('post', OWNER, base(), { fields: ['name'], expiresInDays: 365 })).status, 400);
    const d = (await api('post', OWNER, `/dataforms/${deals._id}/records`, { data: { title: 'D' } })).body.record;
    assert.equal((await api('post', OWNER, `/dataforms/${deals._id}/records/${d._id}/shares`, { fields: ['company'] })).status, 400, 'relationship values are not shared');
    const fields = (await api('get', OWNER, `/dataforms/${contacts._id}`)).body.fields;
    await api('patch', OWNER, `/dataforms/${contacts._id}/fields/${fields.find((f) => f.key === 'last_contacted')._id}`, { visibility: { list: false } }).expect(200);
    assert.equal((await api('post', OWNER, base(), { fields: ['last_contacted'] })).status, 400, 'hidden fields are not shared');
  });

  it('creates a link that is shown once and stored only as a hash', async () => {
    const res = await api('post', OWNER, base(), { fields: ['name', 'status', 'email'], expiresInDays: 3 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ({ share, token } = res.body);
    assert.ok(token.length >= 40);
    assert.ok(res.body.url.endsWith(`/s/${token}`));
    assert.equal(share.tokenHash, undefined);
    const raw = await mongoose.connection.collection('publicshares').findOne({ _id: new mongoose.Types.ObjectId(share._id) });
    assert.equal(raw.tokenHash, hashToken(token));
    assert.ok(!JSON.stringify(raw).includes(token));
    const list = (await api('get', OWNER, base())).body.data;
    assert.equal(list.length, 1);
    assert.ok(!JSON.stringify(list).includes(token));
    assert.equal(list[0].active, true);
    assert.ok(Math.abs(new Date(share.expiresAt) - Date.now() - 3 * 864e5) < 60_000);
  });

  it('shows visitors exactly the chosen fields, read-only, and keeps count', async () => {
    const res = await anon('get', `/shares/${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.title, 'Shared Sam');
    assert.equal(res.body.dataformName, 'Leads');
    assert.deepEqual(res.body.fields.map((f) => [f.key, f.value]), [['name', 'Shared Sam'], ['status', 'customer'], ['email', 'sam@share.test']]);
    assert.ok(!JSON.stringify(res.body).includes('555'), 'phone was not shared');
    assert.ok(!/[a-f0-9]{24}/.test(JSON.stringify(res.body)));
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal((await anon('post', `/shares/${token}`)).status, 404, 'no way to change anything');
    const stored = await PublicShare.findById(share._id);
    assert.equal(stored.viewCount, 1);
    assert.ok(stored.lastViewedAt);
    await api('patch', OWNER, `/dataforms/${contacts._id}/records/${rec._id}`, { data: { status: 'churned' } }).expect(200);
    assert.equal((await anon('get', `/shares/${token}`)).body.fields[1].value, 'churned', 'always the current value');
  });

  it('gives one identical answer for unknown, expired, revoked and deleted', async () => {
    const miss = await anon('get', '/shares/' + 'z'.repeat(43));
    assert.equal(miss.status, 404);
    await PublicShare.updateOne({ _id: share._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await anon('get', `/shares/${token}`);
    assert.equal(expired.status, 404);
    assert.deepEqual(expired.body, miss.body);
    await PublicShare.updateOne({ _id: share._id }, { $set: { expiresAt: new Date(Date.now() + 864e5) } });
    assert.equal((await anon('get', `/shares/${token}`)).status, 200);

    assert.equal((await api('delete', GLOBEX, `${base()}/${share._id}`)).status, 404);
    await api('delete', OWNER, `${base()}/${share._id}`).expect(204);
    const revoked = await anon('get', `/shares/${token}`);
    assert.deepEqual(revoked.body, miss.body);
    assert.equal((await api('get', OWNER, base())).body.data[0].active, false);

    const again = (await api('post', OWNER, base(), { fields: ['name'] })).body;
    assert.equal((await anon('get', `/shares/${again.token}`)).status, 200);
    await api('delete', OWNER, `/dataforms/${contacts._id}/records/${rec._id}`).expect(204);
    assert.deepEqual((await anon('get', `/shares/${again.token}`)).body, miss.body, 'deleting the record ends the link');
    assert.equal(await PublicShare.countDocuments({ record: rec._id }), 0);
  });

  it('records who shared what in the audit log', async () => {
    const actions = (await api('get', OWNER, '/audit?limit=100')).body.data.map((a) => a.action);
    for (const a of ['form.created', 'form.updated', 'form.link_regenerated', 'form.deleted', 'share.created', 'share.revoked']) assert.ok(actions.includes(a), a);
  });
});

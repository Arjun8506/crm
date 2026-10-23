import './_env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let mongod; let app; let env; let Account; let Membership; let Feedback; let Announcement; let NpsResponse; let UsageEvent; let setMailer; let User;
const tokens = {}; const ids = {};
const OWNER = 'owner@acme.test'; const ADMIN = 'admin@acme.test'; const MEMBER = 'member@acme.test'; const VIEWER = 'viewer@acme.test'; const TAYLOR = 'taylor@acme.test'; const GLOBEX = 'owner@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  ({ env } = await import('../src/config/env.js'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ Account } = await import('../src/modules/accounts/account.model.js'));
  ({ Membership } = await import('../src/modules/users/membership.model.js'));
  ({ User } = await import('../src/modules/users/user.model.js'));
  ({ Feedback, Announcement, NpsResponse, UsageEvent } = await import('../src/modules/business/business.models.js'));
  ({ setMailer } = await import('../src/providers/email.js'));
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
  for (const who of [OWNER, ADMIN, MEMBER, VIEWER, TAYLOR, GLOBEX]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' });
    tokens[who] = res.body.accessToken; ids[who] = res.body.user._id;
  }
});

after(async () => {
  setMailer(undefined);
  delete env.SUPPORT_EMAIL;
  await mongoose.disconnect();
  await mongod.stop();
});

describe('onboarding', () => {
  let fresh;
  before(async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({ name: 'Nia New', email: 'nia@fresh.test', password: 'Passw0rd!demo', accountName: 'Fresh Org' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    tokens.FRESH = res.body.accessToken;
    fresh = res.body;
  });

  it('computes the checklist from what really exists, and offers setup to a new owner', async () => {
    const res = await api('get', 'FRESH', '/onboarding');
    assert.equal(res.status, 200);
    assert.equal(res.body.setupNeeded, true);
    assert.equal(res.body.doneCount, 0);
    assert.equal(res.body.total, 8);
    assert.deepEqual(res.body.steps.filter((s) => s.done), []);
    assert.ok(res.body.templates.some((t) => t.id === 'contacts'));
    const seeded = await api('get', OWNER, '/onboarding');
    assert.equal(seeded.body.setupNeeded, false, 'organisations that finished setup are not asked again');
    assert.ok(seeded.body.steps.find((s) => s.id === 'team').done && seeded.body.steps.find((s) => s.id === 'automation').done);
    assert.equal((await api('get', MEMBER, '/onboarding')).body.setupNeeded, false, 'only admins are offered setup');
    assert.equal((await request(app).get('/api/v1/onboarding')).status, 401);
  });

  it('validates the setup form', async () => {
    const post = (body) => api('post', 'FRESH', '/onboarding/setup', body);
    assert.equal((await post({ workspaceName: 'x', templates: [] })).status, 400);
    assert.equal((await post({ workspaceName: 'Sales', templates: ['nonsense'] })).status, 400);
    assert.equal((await post({ workspaceName: 'Sales', templates: [], timezone: 'Mars/Olympus' })).status, 400);
    assert.equal((await api('post', MEMBER, '/onboarding/setup', { workspaceName: 'Nope', templates: [] })).status, 403);
  });

  it('creates the workspace and starter dataforms, records the profile, and only runs once', async () => {
    const res = await api('post', 'FRESH', '/onboarding/setup', { workspaceName: 'Sales team', industry: 'Software', timezone: 'Europe/Berlin', templates: ['contacts', 'deals', 'contacts'] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.workspace.name, 'Sales team');
    assert.deepEqual(res.body.dataforms.map((d) => d.name), ['Contacts', 'Deals'], 'a repeated template is created once');
    const forms = (await api('get', 'FRESH', `/dataforms?workspaceId=${res.body.workspace._id}`)).body.data;
    assert.equal(forms.length, 2);
    assert.ok(forms.every((f) => f.fieldCount >= 5), 'with their fields');
    const account = await Account.findById(fresh.account._id ?? fresh.account.id);
    assert.equal(account.settings.industry, 'Software');
    assert.equal(account.settings.timezone, 'Europe/Berlin');
    assert.ok(account.onboarding.completedAt);
    const check = (await api('get', 'FRESH', '/onboarding')).body;
    assert.equal(check.setupNeeded, false);
    for (const id of ['profile', 'workspace', 'dataform']) assert.ok(check.steps.find((s) => s.id === id).done, id);
    for (const id of ['records', 'team', 'task', 'automation', 'connect']) assert.ok(!check.steps.find((s) => s.id === id).done, id);
    assert.equal((await api('post', 'FRESH', '/onboarding/setup', { workspaceName: 'Again', templates: [] })).status, 409);
  });

  it('ticks items off as the work is really done', async () => {
    const check = async () => Object.fromEntries((await api('get', 'FRESH', '/onboarding')).body.steps.map((s) => [s.id, s.done]));
    const ws = (await api('get', 'FRESH', '/workspaces')).body.data[0];
    const contacts = (await api('get', 'FRESH', `/dataforms?workspaceId=${ws._id}`)).body.data.find((d) => d.name === 'Contacts');
    await api('post', 'FRESH', `/dataforms/${contacts._id}/records`, { data: { name: 'First' } }).expect(201);
    await api('post', 'FRESH', '/tasks', { workspaceId: ws._id, title: 'First task' }).expect(201);
    const now = await check();
    assert.ok(now.records && now.task);
    assert.ok(!now.team && !now.automation);
  });

  it('can be skipped or dismissed, and brought back', async () => {
    const dismissed = await request(app).post('/api/v1/auth/signup').send({ name: 'Dee', email: 'dee@skip.test', password: 'Passw0rd!demo', accountName: 'Skipper' });
    const t = dismissed.body.accessToken;
    const call = (m, u) => request(app)[m](`/api/v1${u}`).set({ Authorization: `Bearer ${t}` });
    assert.equal((await call('get', '/onboarding')).body.setupNeeded, true);
    await call('post', '/onboarding/skip').expect(200);
    const after = (await call('get', '/onboarding')).body;
    assert.equal(after.setupNeeded, false);
    assert.equal(after.doneCount, 0, 'skipping does not pretend anything was done');
    await call('post', '/onboarding/dismiss').expect(200);
    assert.ok((await call('get', '/onboarding')).body.dismissedAt);
    await call('post', '/onboarding/reopen').expect(200);
    assert.equal((await call('get', '/onboarding')).body.dismissedAt, null);
  });
});

describe('feedback and support', () => {
  it('lets anyone send feedback and see their own submissions', async () => {
    const res = await api('post', VIEWER, '/feedback', { type: 'idea', message: 'Please add a dark map style', page: '/w/abc/f/def' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.emailed, false, 'no support address is configured, so it is stored only');
    assert.equal((await api('post', VIEWER, '/feedback', { type: 'rant', message: 'Hello there' })).status, 400);
    assert.equal((await api('post', VIEWER, '/feedback', { type: 'bug', message: 'no' })).status, 400);
    assert.equal((await api('post', VIEWER, '/feedback', { type: 'bug', message: 'x'.repeat(2001) })).status, 400);
    assert.equal((await request(app).post('/api/v1/feedback').send({ type: 'idea', message: 'anonymous' })).status, 401);
    const mine = (await api('get', VIEWER, '/feedback/mine')).body.data;
    assert.equal(mine.length, 1);
    assert.equal((await api('get', MEMBER, '/feedback/mine')).body.data.length, 0, 'people only see their own');
  });

  it('shows all feedback to admins, who can triage it, within their own organisation', async () => {
    await api('post', MEMBER, '/feedback', { type: 'bug', message: 'The kanban card jumps when dropped' }).expect(201);
    assert.equal((await api('get', MEMBER, '/feedback')).status, 403);
    const list = (await api('get', ADMIN, '/feedback')).body;
    assert.equal(list.total, 2);
    assert.equal(list.data[0].user.name.length > 0, true);
    assert.equal((await api('get', ADMIN, '/feedback?type=bug')).body.total, 1);
    const id = list.data[0]._id;
    assert.equal((await api('patch', ADMIN, `/feedback/${id}`, { status: 'planned' })).body.feedback.status, 'planned');
    assert.equal((await api('patch', ADMIN, `/feedback/${id}`, { status: 'whatever' })).status, 400);
    assert.equal((await api('get', GLOBEX, '/feedback')).body.total, 0);
    assert.equal((await api('patch', GLOBEX, `/feedback/${id}`, { status: 'closed' })).status, 404);
  });

  it('also emails the support address when one and a mail server are configured, and still saves if sending fails', async () => {
    const sent = [];
    setMailer({ send: async (m) => { sent.push(m); } });
    env.SUPPORT_EMAIL = 'help@vendor.test';
    const ok = await api('post', MEMBER, '/feedback', { type: 'question', message: 'How do I import from Excel?' });
    assert.equal(ok.body.emailed, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'help@vendor.test');
    assert.equal(sent[0].replyTo, MEMBER);
    assert.match(sent[0].text, /How do I import from Excel/);
    setMailer({ send: async () => { throw new Error('smtp down'); } });
    const failed = await api('post', MEMBER, '/feedback', { type: 'question', message: 'Is anyone there?' });
    assert.equal(failed.status, 201);
    assert.equal(failed.body.emailed, false);
    assert.ok(await Feedback.findOne({ message: 'Is anyone there?' }), 'the message was not lost');
    setMailer(undefined);
    delete env.SUPPORT_EMAIL;
  });
});

describe('news and announcements', () => {
  it('shows product news and organisation announcements, with unread counts', async () => {
    const before = (await api('get', MEMBER, '/announcements')).body;
    assert.ok(before.data.some((i) => i.kind === 'product'));
    const post = await api('post', ADMIN, '/announcements', { title: 'Office closed Friday', body: 'Back on Monday.' });
    assert.equal(post.status, 201);
    const after = (await api('get', MEMBER, '/announcements')).body;
    const mine = after.data.find((i) => i.title === 'Office closed Friday');
    assert.equal(mine.kind, 'organisation');
    assert.equal(mine.unread, true);
    assert.ok(after.unread >= 1);
    await api('post', MEMBER, '/announcements/seen').expect(200);
    const seen = (await api('get', MEMBER, '/announcements')).body;
    assert.equal(seen.unread, 0);
    assert.equal(seen.data.find((i) => i.title === 'Office closed Friday').unread, false);
    assert.equal((await api('get', GLOBEX, '/announcements')).body.data.some((i) => i.title === 'Office closed Friday'), false, 'organisation news stays in its organisation');
  });

  it('is written by admins only, can expire, and can be removed', async () => {
    assert.equal((await api('post', MEMBER, '/announcements', { title: 'Free pizza', body: '' })).status, 403);
    assert.equal((await api('post', ADMIN, '/announcements', { title: 'x', body: '' })).status, 400);
    const timed = (await api('post', ADMIN, '/announcements', { title: 'Short lived', body: '', expiresInDays: 1 })).body.announcement;
    await Announcement.updateOne({ _id: timed._id }, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await api('get', MEMBER, '/announcements')).body.data.some((i) => i.title === 'Short lived'), false);
    const doomed = (await api('post', ADMIN, '/announcements', { title: 'Delete me', body: '' })).body.announcement;
    assert.equal((await api('delete', GLOBEX, `/announcements/${doomed._id}`)).status, 404);
    assert.equal((await api('delete', MEMBER, `/announcements/${doomed._id}`)).status, 403);
    await api('delete', ADMIN, `/announcements/${doomed._id}`).expect(204);
  });
});

describe('the NPS survey', () => {
  it('is not shown to people who only just joined', async () => {
    await Membership.collection.updateMany({}, { $set: { createdAt: new Date() } });
    const res = await api('get', MEMBER, '/nps/eligibility');
    assert.deepEqual([res.body.eligible, res.body.reason], [false, 'too_new']);
    assert.equal((await api('post', MEMBER, '/nps', { score: 9 })).status, 409);
  });

  it('asks once they have been around a while, records the answer, and then leaves them alone', async () => {
    await Membership.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 30 * 864e5) } });
    assert.equal((await api('get', MEMBER, '/nps/eligibility')).body.eligible, true);
    assert.equal((await api('post', MEMBER, '/nps', { score: 11 })).status, 400);
    assert.equal((await api('post', MEMBER, '/nps', { score: 'high' })).status, 400);
    assert.equal((await api('post', MEMBER, '/nps', { score: 9, comment: 'Love the automation' })).status, 201);
    assert.deepEqual((await api('get', MEMBER, '/nps/eligibility')).body, { eligible: false, reason: 'answered_recently' });
    assert.equal((await api('post', MEMBER, '/nps', { score: 3 })).status, 409, 'one answer per period');
  });

  it('remembers a dismissal for a while, then asks again', async () => {
    await api('post', TAYLOR, '/nps/dismiss').expect(200);
    assert.deepEqual((await api('get', TAYLOR, '/nps/eligibility')).body, { eligible: false, reason: 'dismissed_recently' });
    await NpsResponse.updateMany({ user: ids[TAYLOR] }, { createdAt: new Date(Date.now() - 40 * 864e5) });
    assert.equal((await api('get', TAYLOR, '/nps/eligibility')).body.eligible, true);
  });

  it('summarises responses for admins as an NPS score', async () => {
    await api('post', VIEWER, '/nps', { score: 10 }).expect(201);
    await api('post', ADMIN, '/nps', { score: 7 }).expect(201);
    await api('post', OWNER, '/nps', { score: 2, comment: 'Too slow on big imports' }).expect(201);
    assert.equal((await api('get', MEMBER, '/nps/summary')).status, 403);
    const s = (await api('get', ADMIN, '/nps/summary')).body;
    assert.deepEqual([s.responses, s.promoters, s.passives, s.detractors], [4, 2, 1, 1]);
    assert.equal(s.nps, 25, '(2 promoters - 1 detractor) / 4 responses');
    assert.ok(s.recent.some((r) => r.comment === 'Too slow on big imports' && r.score === 2));
    assert.equal((await api('get', GLOBEX, '/nps/summary')).body.responses, 0);
  });
});

describe('privacy-conscious usage tracking', () => {
  const track = (who, name, headers = {}) => request(app).post('/api/v1/events').set({ Authorization: `Bearer ${tokens[who]}`, ...headers }).send({ name });
  const acme = () => Account.findOne({ plan: 'team' });

  it('records only the names of known pages and features, linked to a one-way code', async () => {
    assert.equal((await track(MEMBER, 'page.dataform')).status, 204);
    assert.equal((await track(MEMBER, 'feature.import')).status, 204);
    assert.equal((await track(MEMBER, 'page.something-secret')).status, 400, 'only allowlisted names');
    assert.equal((await request(app).post('/api/v1/events').send({ name: 'page.dataform' })).status, 401);
    const rows = await UsageEvent.find({}).lean();
    assert.equal(rows.length, 2);
    const raw = JSON.stringify(rows);
    for (const identifying of [ids[MEMBER], MEMBER, 'member']) assert.ok(!raw.includes(identifying), `${identifying} must not be stored`);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['_id', '__v', 'account', 'actor', 'at', 'name'].sort());
    assert.match(rows[0].actor, /^[a-f0-9]{24}$/);
  });

  it('respects Do Not Track, a personal opt-out and the organisation setting', async () => {
    const n = () => UsageEvent.countDocuments({});
    const base = await n();
    assert.equal((await track(MEMBER, 'page.tasks', { DNT: '1' })).status, 204);
    assert.equal((await track(MEMBER, 'page.tasks', { 'Sec-GPC': '1' })).status, 204);
    assert.equal(await n(), base, 'the browser asked not to be tracked');

    await api('patch', MEMBER, '/users/me', { preferences: { analytics: false } }).expect(200);
    assert.equal((await api('get', MEMBER, '/events/privacy')).body.person, false);
    await track(MEMBER, 'page.tasks');
    assert.equal(await n(), base, 'a person who opted out is not recorded');
    await api('patch', MEMBER, '/users/me', { preferences: { analytics: true } }).expect(200);

    await api('patch', OWNER, '/accounts/current', { settings: { analytics: false } }).expect(200);
    await track(ADMIN, 'page.reports');
    assert.equal(await n(), base, 'an organisation can switch it off for everyone');
    assert.equal((await api('get', MEMBER, '/events/privacy')).body.organisation, false);
    await api('patch', OWNER, '/accounts/current', { settings: { analytics: true } }).expect(200);
    await track(ADMIN, 'page.reports');
    assert.equal(await n(), base + 1);
  });

  it('shows admins counts of use without names, and lets a person delete their own record', async () => {
    await track(VIEWER, 'page.dataform');
    await track(MEMBER, 'page.dataform');
    assert.equal((await api('get', MEMBER, '/events/summary')).status, 403);
    const s = (await api('get', ADMIN, '/events/summary?days=30')).body;
    const dataform = s.features.find((f) => f.name === 'page.dataform');
    assert.deepEqual([dataform.events, dataform.people], [3, 2]);
    assert.ok(s.activePeople >= 3);
    assert.ok(!JSON.stringify(s).match(/member@|viewer@|actor/), 'no identities in the report');
    assert.equal((await api('get', GLOBEX, '/events/summary')).body.activePeople, 0);

    const del = await api('delete', MEMBER, '/events/me');
    assert.equal(del.body.deleted, 3, 'their own events only');
    const after = (await api('get', ADMIN, '/events/summary')).body.features.find((f) => f.name === 'page.dataform');
    assert.deepEqual([after.events, after.people], [1, 1]);
  });

  it('keeps nothing forever', async () => {
    const index = (await UsageEvent.collection.indexes()).find((i) => i.key.at === 1 && i.expireAfterSeconds);
    assert.equal(index.expireAfterSeconds, 180 * 86400);
    assert.ok((await acme()), 'sanity');
    assert.ok(await User.findById(ids[MEMBER]));
  });
});

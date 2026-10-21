import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { io as connect } from 'socket.io-client';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';
const storageDir = mkdtempSync(join(tmpdir(), 'orgcrm-files-'));
process.env.STORAGE_DIR = storageDir;

let mongod; let app; let server; let port; let setMailer; let runScheduledNotifications;
const tokens = {}; const ids = {};
const OWNER = 'owner@acme.test'; const ADMIN = 'admin@acme.test'; const MEMBER = 'member@acme.test'; const VIEWER = 'viewer@acme.test'; const TAYLOR = 'taylor@acme.test'; const GLOBEX = 'owner@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};
const notifications = async (who, type) => (await api('get', who, '/notifications?limit=50')).body.data.filter((n) => !type || n.type === type);

let ws; let privateWs; let contacts; let record; let privateForm; let privateRecord;
const rec = (path = '') => `/dataforms/${contacts._id}/records/${record._id}${path}`;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ setMailer } = await import('../src/providers/email.js'));
  ({ runScheduledNotifications } = await import('../src/jobs/scheduler.js'));
  const { attachSockets } = await import('../src/sockets/index.js');
  await seed();
  // The seed ships demo comments, tasks and notifications; these tests assert exact counts from a clean slate.
  for (const name of ['Notification', 'Task', 'TaskActivity', 'Comment', 'Follow']) await mongoose.model(name).deleteMany({});
  await mongoose.syncIndexes();
  app = createApp();
  server = http.createServer(app);
  attachSockets(server);
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;

  for (const who of [OWNER, ADMIN, MEMBER, VIEWER, TAYLOR, GLOBEX]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' });
    tokens[who] = res.body.accessToken;
    ids[who] = res.body.user._id;
  }
  ws = (await api('post', OWNER, '/workspaces', { name: 'Collab space' })).body.workspace;
  privateWs = (await api('get', OWNER, '/workspaces')).body.data.find((w) => w.name === 'Executive Planning');
  contacts = (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name: 'People', templateId: 'contacts' })).body.dataform;
  record = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Ada Lovelace' } })).body.record;
  privateForm = (await api('post', OWNER, '/dataforms', { workspaceId: privateWs._id, name: 'Board', templateId: 'tickets' })).body.dataform;
  privateRecord = (await api('post', OWNER, `/dataforms/${privateForm._id}/records`, { data: { subject: 'Secret plan' } })).body.record;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('comments, mentions and following', () => {
  let top;
  it('posts comments and one-level replies, and rejects deeper nesting', async () => {
    const res = await api('post', MEMBER, rec('/comments'), { body: 'First thoughts' });
    assert.equal(res.status, 201);
    top = res.body.comment;
    const reply = await api('post', OWNER, rec('/comments'), { body: 'Agreed', parent: top._id });
    assert.equal(reply.status, 201);
    assert.equal((await api('post', OWNER, rec('/comments'), { body: 'too deep', parent: reply.body.comment._id })).status, 400);
    const thread = (await api('get', OWNER, rec('/comments'))).body;
    assert.equal(thread.data.length, 1);
    assert.equal(thread.data[0].replies.length, 1);
    assert.equal(thread.data[0].author.name, 'Jordan Lee');
  });

  it('enforces permissions and tenant isolation', async () => {
    assert.equal((await api('post', VIEWER, rec('/comments'), { body: 'viewers read only' })).status, 403);
    assert.equal((await api('get', VIEWER, rec('/comments'))).status, 200);
    assert.equal((await api('get', GLOBEX, rec('/comments'))).status, 404);
    assert.equal((await api('post', MEMBER, rec('/comments'), { body: '   ' })).status, 400);
    assert.equal((await api('patch', OWNER, `/comments/${top._id}`, { body: 'hijack', mentions: [] })).status, 403, 'only the author edits');
    assert.equal((await api('patch', MEMBER, `/comments/${top._id}`, { body: 'First thoughts (edited)', mentions: [] })).status, 200);
    assert.equal((await api('delete', GLOBEX, `/comments/${top._id}`)).status, 404);
  });

  it('notifies mentioned users and followers, never the author, and ignores mentions of people without access', async () => {
    // Taylor mentions the owner; also tries to mention a user who cannot open the private workspace
    const before = (await notifications(OWNER)).length;
    await api('post', TAYLOR, rec('/comments'), { body: 'Hey @Alex, please review', mentions: [ids[OWNER]] }).expect(201);
    const mention = (await notifications(OWNER, 'mention'))[0];
    assert.match(mention.title, /Taylor Brooks mentioned you on Ada Lovelace/);
    assert.ok(mention.link.includes(`record=${record._id}`));
    assert.equal((await notifications(OWNER)).length, before + 1, 'mention only, not a second "comment" notification');
    assert.equal((await notifications(TAYLOR)).filter((n) => n.type === 'mention' || n.type === 'comment').length, 0, 'author is not notified');

    // member (follower since they commented) gets a plain comment notification
    assert.ok((await notifications(MEMBER, 'comment')).some((n) => n.title.includes('Taylor Brooks commented')));

    // a mention of someone with no access to a private record is dropped
    const secret = await api('post', OWNER, `/dataforms/${privateForm._id}/records/${privateRecord._id}/comments`, { body: 'Confidential, @Jordan', mentions: [ids[MEMBER], ids[ADMIN]] });
    assert.equal(secret.status, 201);
    assert.deepEqual(secret.body.comment.mentions.map(String), [ids[ADMIN]]);
    assert.equal((await notifications(MEMBER)).some((n) => n.title.includes('Confidential')), false);
  });

  it('supports manual follow/unfollow, auto-follow, and record-update notifications for followers', async () => {
    assert.equal((await api('get', VIEWER, rec('/comments'))).body.following, false);
    assert.equal((await api('put', VIEWER, rec('/follow'))).body.following, true);
    assert.equal((await api('get', VIEWER, rec('/comments'))).body.following, true);
    assert.equal((await api('get', MEMBER, rec('/comments'))).body.following, true, 'auto-followed by commenting');

    await api('patch', OWNER, rec(), { data: { status: 'customer' } }).expect(200);
    const upd = (await notifications(VIEWER, 'record_update'))[0];
    assert.match(upd.title, /Alex Morgan updated Ada Lovelace/);
    assert.match(upd.body, /Status/);

    await api('delete', VIEWER, rec('/follow')).expect(200);
    await api('patch', OWNER, rec(), { data: { status: 'lead' } }).expect(200);
    assert.equal((await notifications(VIEWER, 'record_update')).length, 1, 'unfollowed users stop receiving updates');
  });

  it('lets authors and workspace admins delete, removing replies too', async () => {
    const c = (await api('post', MEMBER, rec('/comments'), { body: 'to delete' })).body.comment;
    await api('post', OWNER, rec('/comments'), { body: 'reply', parent: c._id }).expect(201);
    assert.equal((await api('delete', TAYLOR, `/comments/${c._id}`)).status, 403);
    assert.equal((await api('delete', OWNER, `/comments/${c._id}`)).status, 204, 'workspace admin');
    const thread = (await api('get', OWNER, rec('/comments'))).body.data;
    assert.ok(!thread.some((t) => t._id === c._id));
    assert.ok(!thread.flatMap((t) => t.replies).some((r) => r.body === 'reply'));
  });
});

describe('notification centre and preferences', () => {
  it('lists, counts, marks read, and keeps notifications private to their owner', async () => {
    const list = (await api('get', OWNER, '/notifications?unread=true')).body;
    assert.ok(list.unread > 0);
    const n = list.data[0];
    assert.equal((await api('post', MEMBER, `/notifications/${n._id}/read`)).status, 404, "cannot read someone else's");
    assert.equal((await api('post', OWNER, `/notifications/${n._id}/read`)).status, 200);
    assert.equal((await api('get', OWNER, '/notifications/unread-count')).body.unread, list.unread - 1);
    await api('post', OWNER, '/notifications/read-all').expect(200);
    assert.equal((await api('get', OWNER, '/notifications/unread-count')).body.unread, 0);
    assert.equal((await api('delete', MEMBER, `/notifications/${n._id}`)).status, 404);
  });

  it('respects in-app preferences and validates them', async () => {
    assert.equal((await api('put', ADMIN, '/notifications/preferences', { inApp: { bogus: false }, email: {} })).status, 400);
    await api('put', ADMIN, '/notifications/preferences', { inApp: { comment: false }, email: {} }).expect(200);
    await api('put', ADMIN, rec('/follow')).expect(200);
    await api('post', OWNER, rec('/comments'), { body: 'muted for admin' }).expect(201);
    assert.equal((await notifications(ADMIN, 'comment')).length, 0);
    await api('put', ADMIN, '/notifications/preferences', { inApp: {}, email: {} }).expect(200);
    await api('post', OWNER, rec('/comments'), { body: 'audible for admin' }).expect(201);
    assert.equal((await notifications(ADMIN, 'comment')).length, 1);
  });

  it('sends email only to opted-in users and only when a transport exists; never fakes delivery', async () => {
    const sent = [];
    await api('put', ADMIN, '/notifications/preferences', { inApp: {}, email: { comment: true } }).expect(200);
    await api('put', VIEWER, rec('/follow')).expect(200);

    setMailer(null);
    assert.equal((await api('get', ADMIN, '/notifications/preferences')).body.emailConfigured, false);
    await api('post', OWNER, rec('/comments'), { body: 'no transport' }).expect(201);
    assert.equal(sent.length, 0);

    setMailer({ send: async (m) => { sent.push(m); } });
    assert.equal((await api('get', ADMIN, '/notifications/preferences')).body.emailConfigured, true);
    await api('post', OWNER, rec('/comments'), { body: 'with transport <b>html</b>' }).expect(201);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(sent.map((m) => m.to), ['admin@acme.test'], 'only the opted-in user');
    assert.ok(!sent[0].html.includes('<b>html</b>'), 'html is escaped');

    setMailer({ send: async () => { throw new Error('smtp down'); } });
    await api('post', OWNER, rec('/comments'), { body: 'provider failure' }).expect(201);
    setMailer(undefined);
  });

  it('registers push device tokens as an integration point', async () => {
    const res = await api('post', MEMBER, '/notifications/push/devices', { platform: 'fcm', token: 'device-token-1234' });
    assert.equal(res.status, 201);
    assert.equal(res.body.deliveryConfigured, false);
    assert.equal((await api('post', MEMBER, '/notifications/push/devices', { platform: 'sms', token: 'x'.repeat(20) })).status, 400);
    await api('delete', MEMBER, '/notifications/push/devices', { platform: 'fcm', token: 'device-token-1234' }).expect(204);
  });
});

describe('tasks and reminders', () => {
  let task;
  const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

  it('creates tasks, validates assignees and notifies them', async () => {
    const res = await api('post', OWNER, '/tasks', { workspaceId: ws._id, recordId: record._id, title: 'Call Ada', assignees: [ids[MEMBER], ids[TAYLOR]], priority: 'high', due: iso(3 * 864e5) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    task = res.body.task;
    assert.equal(task.dataform, contacts._id);
    assert.ok((await notifications(MEMBER, 'task_assigned')).some((n) => n.title.includes('Call Ada')));
    assert.equal((await notifications(OWNER, 'task_assigned')).length, 0);
    assert.equal((await api('post', VIEWER, '/tasks', { workspaceId: ws._id, title: 'no' })).status, 403);
    assert.equal((await api('post', OWNER, '/tasks', { workspaceId: privateWs._id, title: 'Board prep', assignees: [ids[MEMBER]] })).status, 400, 'assignee cannot open the private workspace');
    assert.equal((await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'bad ref', recordId: privateRecord._id })).status, 404);
    assert.equal((await api('post', GLOBEX, '/tasks', { workspaceId: ws._id, title: 'x' })).status, 404);
  });

  it('shows My Tasks with date ranges and workspace views, undated last', async () => {
    await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'No date', assignees: [ids[MEMBER]] }).expect(201);
    await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'Overdue one', assignees: [ids[MEMBER]], due: iso(-2 * 864e5) }).expect(201);
    const mine = (await api('get', MEMBER, '/tasks')).body;
    assert.deepEqual(mine.data.map((t) => t.title), ['Overdue one', 'Call Ada', 'No date']);
    assert.equal(mine.data[1].recordRef.label, 'Ada Lovelace');
    const overdue = (await api('get', MEMBER, `/tasks?dueTo=${encodeURIComponent(iso(0))}`)).body;
    assert.deepEqual(overdue.data.map((t) => t.title), ['Overdue one']);
    assert.equal((await api('get', MEMBER, '/tasks?noDue=true')).body.total, 1);
    assert.equal((await api('get', OWNER, '/tasks')).body.total, 0, 'My Tasks only lists tasks assigned to me');
    assert.equal((await api('get', OWNER, `/tasks?scope=workspace&workspaceId=${ws._id}`)).body.total, 3);
    assert.equal((await api('get', GLOBEX, `/tasks?scope=workspace&workspaceId=${ws._id}`)).status, 404);
  });

  it('limits who can change what and records activity', async () => {
    assert.equal((await api('patch', MEMBER, `/tasks/${task._id}`, { title: 'Hijacked' })).status, 403, 'assignees cannot rename');
    assert.equal((await api('patch', VIEWER, `/tasks/${task._id}`, { status: 'done' })).status, 403);
    assert.equal((await api('patch', MEMBER, `/tasks/${task._id}`, { status: 'in_progress' })).status, 200);
    const done = (await api('patch', MEMBER, `/tasks/${task._id}`, { status: 'done' })).body.task;
    assert.ok(done.completedAt);
    await api('patch', OWNER, `/tasks/${task._id}`, { status: 'todo', title: 'Call Ada today' }).expect(200);
    const detail = (await api('get', VIEWER, `/tasks/${task._id}`)).body;
    assert.equal(detail.task.completedAt, undefined, 'reopening clears completion');
    assert.deepEqual(detail.activity.map((a) => a.action), ['update', 'update', 'update', 'create']);
    assert.ok(detail.activity[0].changes.some((c) => c.field === 'title' && c.to === 'Call Ada today'));
    assert.equal((await api('patch', OWNER, `/tasks/${task._id}`, { assignees: [ids[MEMBER], ids[VIEWER]] })).status, 200);
    assert.ok((await notifications(VIEWER, 'task_assigned')).length >= 1);
    assert.equal((await api('delete', MEMBER, `/tasks/${task._id}`)).status, 403);
  });

  it('supports task comments with notifications', async () => {
    const c = await api('post', MEMBER, `/tasks/${task._id}/comments`, { body: 'Left a voicemail', mentions: [ids[TAYLOR]] });
    assert.equal(c.status, 201);
    assert.ok((await notifications(TAYLOR, 'mention')).some((n) => n.title.includes('Call Ada today')));
    assert.ok((await notifications(OWNER, 'task_comment')).length >= 1, 'creator is told');
    assert.equal((await api('get', VIEWER, `/tasks/${task._id}/comments`)).body.data.length, 1);
    assert.equal((await api('post', VIEWER, `/tasks/${task._id}/comments`, { body: 'x' })).status, 403);
  });

  it('sends reminders, due-soon and overdue notifications exactly once, and skips finished tasks', async () => {
    const mk = (b) => api('post', OWNER, '/tasks', { workspaceId: ws._id, assignees: [ids[TAYLOR]], ...b }).expect(201);
    const reminder = (await mk({ title: 'Remind me', reminderAt: iso(-1000) })).body.task;
    await mk({ title: 'Future reminder', reminderAt: iso(10 * 864e5) });
    await mk({ title: 'Due tomorrow', due: iso(12 * 3600e3) });
    await mk({ title: 'Long overdue', due: iso(-5 * 864e5) });
    const finished = (await mk({ title: 'Already done', due: iso(-5 * 864e5), status: 'done' })).body.task;

    const first = await runScheduledNotifications();
    assert.deepEqual(first, { reminders: 1, overdue: 2, soon: 1 }, 'includes the earlier "Overdue one" task');
    const second = await runScheduledNotifications();
    assert.deepEqual(second, { reminders: 0, overdue: 0, soon: 0 }, 'no duplicates on a second run');
    const t = await notifications(TAYLOR);
    assert.ok(t.some((n) => n.type === 'task_reminder' && n.title === 'Reminder: Remind me'));
    assert.ok(t.some((n) => n.type === 'task_due' && n.title.includes('Due tomorrow')));
    assert.ok(t.some((n) => n.type === 'task_overdue' && n.title.includes('Long overdue')));
    assert.ok(!t.some((n) => n.type !== 'task_assigned' && n.title.includes('Already done')), 'finished tasks are skipped by the scheduler');

    // rescheduling a reminder re-arms it
    await api('patch', OWNER, `/tasks/${reminder._id}`, { reminderAt: iso(-500) }).expect(200);
    assert.equal((await runScheduledNotifications()).reminders, 1);
    assert.ok(finished._id);
  });

  it('runs claims atomically when two schedulers race', async () => {
    await api('post', OWNER, '/tasks', { workspaceId: ws._id, assignees: [ids[TAYLOR]], title: 'Race', reminderAt: iso(-1000) }).expect(201);
    const [a, b] = await Promise.all([runScheduledNotifications(), runScheduledNotifications()]);
    assert.equal(a.reminders + b.reminders, 1);
  });

  it('cascades: deleting a task removes its comments; deleting a record unlinks tasks', async () => {
    const t = (await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'Linked', recordId: record._id })).body.task;
    const tmp = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Temp' } })).body.record;
    const linked = (await api('post', OWNER, '/tasks', { workspaceId: ws._id, title: 'On temp', recordId: tmp._id })).body.task;
    await api('delete', OWNER, `/dataforms/${contacts._id}/records/${tmp._id}`).expect(204);
    const after = (await api('get', OWNER, `/tasks/${linked._id}`)).body.task;
    assert.equal(after.recordRef, null);
    assert.equal((await api('delete', OWNER, `/tasks/${t._id}`)).status, 204);
  });
});

describe('attachments', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  let png; let fake; let note;
  const upload = (who, buf, filename, contentType, extra = {}) => request(app).post(`/api/v1${rec('/attachments')}`).set({ Authorization: `Bearer ${tokens[who]}` })
    .field('description', extra.description ?? '').attach('file', buf, { filename, contentType });

  it('uploads files, flags real images as previewable and rejects dangerous or empty files', async () => {
    const ok = await upload(MEMBER, PNG, 'logo.png', 'image/png', { description: 'Company logo' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    png = ok.body.attachment;
    assert.equal(png.previewable, true);
    assert.equal(png.storageKey, undefined, 'storage keys are never exposed');
    fake = (await upload(MEMBER, Buffer.from('<script>alert(1)</script>'), 'evil.png', 'image/png')).body.attachment;
    assert.equal(fake.previewable, false, 'declared type is not trusted');
    note = (await upload(MEMBER, Buffer.from('hello'), '../../etc/pass"wd.txt', 'text/plain')).body.attachment;
    assert.equal(note.filename, 'pass_wd.txt', 'path and unsafe characters are stripped');
    assert.equal((await upload(MEMBER, Buffer.from('MZ'), 'setup.exe', 'application/octet-stream')).status, 400);
    assert.equal((await upload(MEMBER, Buffer.alloc(0), 'empty.txt', 'text/plain')).status, 400);
    assert.equal((await upload(VIEWER, Buffer.from('hi'), 'a.txt', 'text/plain')).status, 403);
    assert.equal((await upload(GLOBEX, Buffer.from('hi'), 'a.txt', 'text/plain')).status, 404);
    const list = (await api('get', VIEWER, rec('/attachments'))).body;
    assert.equal(list.data.length, 3);
    assert.equal(list.maxUploadMb, 25);
  });

  it('enforces the plan upload limit', async () => {
    const { Account } = await import('../src/modules/accounts/account.model.js');
    await Account.updateOne({ slug: 'acme-industries' }, { 'entitlements.maxUploadMb': 1 });
    const big = await upload(MEMBER, Buffer.alloc(1.5 * 1024 * 1024, 1), 'big.bin', 'application/octet-stream');
    assert.equal(big.status, 413);
    assert.match(big.body.error.message, /1 MB/);
    await Account.updateOne({ slug: 'acme-industries' }, { 'entitlements.maxUploadMb': 25 });
  });

  it('serves downloads only to authorized users, with safe headers', async () => {
    const dl = await api('get', VIEWER, `/attachments/${note._id}/download`);
    assert.equal(dl.status, 200);
    assert.equal(dl.body.toString(), 'hello');
    assert.match(dl.headers['content-disposition'], /^attachment;/);
    assert.equal(dl.headers['x-content-type-options'], 'nosniff');
    assert.equal(dl.headers['content-type'], 'application/octet-stream');

    const inline = await api('get', VIEWER, `/attachments/${png._id}/download?inline=1`);
    assert.match(inline.headers['content-disposition'], /^inline;/);
    assert.equal(inline.headers['content-type'], 'image/png');
    const refused = await api('get', VIEWER, `/attachments/${fake._id}/download?inline=1`);
    assert.match(refused.headers['content-disposition'], /^attachment;/, 'unverified images are never rendered inline');
    assert.equal(refused.headers['content-type'], 'application/octet-stream');

    assert.equal((await api('get', GLOBEX, `/attachments/${png._id}/download`)).status, 404);
    assert.equal((await request(app).get(`/api/v1/attachments/${png._id}/download`)).status, 401);
  });

  it('hides attachments of private workspaces from non-members', async () => {
    const res = await request(app).post(`/api/v1/dataforms/${privateForm._id}/records/${privateRecord._id}/attachments`).set({ Authorization: `Bearer ${tokens[OWNER]}` }).attach('file', Buffer.from('board minutes'), { filename: 'minutes.txt', contentType: 'text/plain' });
    assert.equal(res.status, 201);
    assert.equal((await api('get', MEMBER, `/attachments/${res.body.attachment._id}/download`)).status, 404);
    assert.equal((await api('get', MEMBER, `/dataforms/${privateForm._id}/records/${privateRecord._id}/attachments`)).status, 404);
  });

  it('bundles files into a ZIP and enforces who may delete', async () => {
    const zip = await request(app).post(`/api/v1${rec('/attachments/zip')}`).set({ Authorization: `Bearer ${tokens[VIEWER]}` }).send({}).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers['content-type'], 'application/zip');
    assert.equal(zip.body.subarray(0, 2).toString(), 'PK');
    assert.ok(zip.body.includes(Buffer.from('logo.png')) && zip.body.includes(Buffer.from('pass_wd.txt')));
    assert.equal((await api('post', GLOBEX, rec('/attachments/zip'), {})).status, 404);

    assert.equal((await api('delete', TAYLOR, `/attachments/${note._id}`)).status, 403, 'not the uploader');
    assert.equal((await api('delete', VIEWER, `/attachments/${note._id}`)).status, 403);
    assert.equal((await api('patch', MEMBER, `/attachments/${note._id}`, { description: 'Greeting' })).status, 200);
    assert.equal((await api('delete', OWNER, `/attachments/${note._id}`)).status, 204, 'workspace admin');
    assert.equal((await api('get', OWNER, `/attachments/${note._id}/download`)).status, 404);
  });

  it('deletes file bytes when a record, dataform or workspace is deleted', async () => {
    const { Attachment } = await import('../src/modules/attachments/attachment.model.js');
    const keys = async () => (await Attachment.find({ record: record._id }).select('+storageKey').lean()).map((a) => join(storageDir, a.storageKey));
    const before = await keys();
    assert.ok(before.length >= 1 && before.every((p) => existsSync(p)));
    await api('delete', OWNER, rec()).expect(204);
    assert.ok(before.every((p) => !existsSync(p)), 'bytes removed with the record');
    assert.equal(await Attachment.countDocuments({ record: record._id }), 0);

    const temp = (await api('post', OWNER, '/workspaces', { name: 'Disposable' })).body.workspace;
    const df = (await api('post', OWNER, '/dataforms', { workspaceId: temp._id, name: 'Docs', templateId: 'tickets' })).body.dataform;
    const r = (await api('post', OWNER, `/dataforms/${df._id}/records`, { data: { subject: 'x' } })).body.record;
    const up = await request(app).post(`/api/v1/dataforms/${df._id}/records/${r._id}/attachments`).set({ Authorization: `Bearer ${tokens[OWNER]}` }).attach('file', Buffer.from('bye'), { filename: 'b.txt', contentType: 'text/plain' });
    const key = (await Attachment.findById(up.body.attachment._id).select('+storageKey').lean()).storageKey;
    assert.ok(existsSync(join(storageDir, key)));
    await api('delete', OWNER, `/workspaces/${temp._id}`).expect(204);
    assert.ok(!existsSync(join(storageDir, key)), 'bytes removed with the workspace');
    assert.equal((await api('get', OWNER, `/dataforms/${df._id}`)).status, 404);
  });
});

describe('real-time updates', () => {
  const open = (who, token = tokens[who]) => new Promise((resolve, reject) => {
    const s = connect(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
  const subscribe = (s, workspaceId) => new Promise((r) => s.emit('subscribe', { workspaceId }, r));
  const next = (s, event, ms = 1500) => new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); s.once(event, (p) => { clearTimeout(t); resolve(p); }); });

  it('rejects missing or invalid tokens', async () => {
    await assert.rejects(open(OWNER, 'nope'), /unauthorized/);
    await assert.rejects(open(OWNER, ''), /unauthorized/);
  });

  it('only joins workspace rooms the user may open', async () => {
    const s = await open(MEMBER);
    assert.deepEqual(await subscribe(s, ws._id), { ok: true });
    assert.deepEqual(await subscribe(s, privateWs._id), { ok: false }, 'private workspace');
    assert.deepEqual(await subscribe(s, 'not-an-id'), { ok: false });
    assert.deepEqual(await subscribe(s, { $ne: null }), { ok: false });
    s.close();
    const g = await open(GLOBEX);
    assert.deepEqual(await subscribe(g, ws._id), { ok: false }, 'other tenant');
    g.close();
  });

  it('delivers live events to authorized subscribers only, and notifications to their owner', async () => {
    const df = (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name: 'Live', templateId: 'contacts' })).body.dataform;
    const r = (await api('post', OWNER, `/dataforms/${df._id}/records`, { data: { name: 'Live person' } })).body.record;
    const member = await open(MEMBER); const outsider = await open(GLOBEX); const owner = await open(OWNER);
    await subscribe(member, ws._id); await subscribe(outsider, ws._id);

    const gotRecord = next(member, 'record.changed'); const outsiderRecord = next(outsider, 'record.changed', 600);
    await api('patch', OWNER, `/dataforms/${df._id}/records/${r._id}`, { data: { name: 'Renamed' } }).expect(200);
    const ev = await gotRecord;
    assert.equal(ev.recordId, r._id);
    assert.equal(ev.dataformId, df._id);
    assert.equal(JSON.stringify(ev).includes('Renamed'), false, 'events carry ids, never content');
    assert.equal(await outsiderRecord, null);

    const gotNote = next(member, 'notification.new'); const ownerNote = next(owner, 'notification.new', 600);
    await api('post', OWNER, `/dataforms/${df._id}/records/${r._id}/comments`, { body: 'ping @Jordan', mentions: [ids[MEMBER]] }).expect(201);
    assert.equal((await gotNote).type, 'mention');
    assert.equal(await ownerNote, null, 'the author is not notified');
    member.close(); outsider.close(); owner.close();
  });
});

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.PUBLIC_API_URL = 'https://api.example.test';

let mongod; let app; let setMailer; let setFetch; let drain; let signFor; let Interaction;
const tokens = {}; const ids = {};
const OWNER = 'owner@acme.test'; const MEMBER = 'member@acme.test'; const VIEWER = 'viewer@acme.test'; const GLOBEX = 'owner@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};

const SID = `AC${'a'.repeat(32)}`; const TOKEN = 'twilio-auth-token-123456';
const calls = [];
let twilioStatus = 200;
const fakeNetwork = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, init });
  const json = (status, body) => ({ ok: status < 400, status, statusText: 'x', json: async () => body, text: async () => JSON.stringify(body) });
  if (u.includes('api.twilio.com') && u.endsWith('/Messages.json')) return twilioStatus === 200 ? json(201, { sid: `SM${calls.length}`, status: 'queued' }) : json(twilioStatus, { code: 21211, message: 'Invalid To number' });
  if (u.includes('api.twilio.com') && u.endsWith(`${SID}.json`)) return json(200, { friendly_name: 'Acme Twilio', status: 'active' });
  if (u.startsWith('https://hooks.slack.com/')) return { ok: true, status: 200, text: async () => 'ok' };
  return json(404, { message: 'not mocked' });
};

let ws; let contacts; let record; let followerOnly;
const rec = (p = '') => `/dataforms/${contacts._id}/records/${record._id}${p}`;
const configureTwilio = (extra = {}) => api('put', OWNER, '/integrations/twilio', { secrets: { accountSid: SID, authToken: TOKEN }, settings: { smsFrom: '+14155550100', whatsappFrom: '+14155550101', ...extra } });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ setMailer } = await import('../src/providers/email.js'));
  ({ setFetch } = await import('../src/providers/http.js'));
  ({ drain } = await import('../src/modules/queue/queue.js'));
  ({ signFor } = await import('../src/providers/twilio.js'));
  ({ Interaction } = await import('../src/modules/interactions/interaction.model.js'));
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
  setFetch(fakeNetwork);
  setMailer(null);
  for (const who of [OWNER, MEMBER, VIEWER, GLOBEX]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' });
    tokens[who] = res.body.accessToken; ids[who] = res.body.user._id;
  }
  ws = (await api('post', OWNER, '/workspaces', { name: 'Comms space' })).body.workspace;
  contacts = (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name: 'People', templateId: 'contacts' })).body.dataform;
  record = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+1 (415) 555-0123', status: 'customer' } })).body.record;
  followerOnly = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Grace Hopper' } })).body.record;
});

after(async () => {
  setFetch(undefined); setMailer(undefined);
  await mongoose.disconnect();
  await mongod.stop();
});

describe('integrations', () => {
  it('is restricted to account admins and validates credentials', async () => {
    assert.equal((await api('get', MEMBER, '/integrations')).status, 403);
    assert.equal((await api('put', MEMBER, '/integrations/slack', { secrets: { webhookUrl: 'https://hooks.slack.com/services/T/B/x' } })).status, 403);
    assert.equal((await api('put', GLOBEX, '/integrations/slack', { secrets: { webhookUrl: 'https://evil.example.com/services/T/B/x' } })).status, 400, 'only hooks.slack.com is accepted');
    assert.equal((await api('put', OWNER, '/integrations/twilio', { secrets: { accountSid: 'nope', authToken: 'x'.repeat(20) }, settings: { smsFrom: '+14155550100' } })).status, 400);
    assert.equal((await api('put', OWNER, '/integrations/twilio', { secrets: { accountSid: SID, authToken: TOKEN }, settings: {} })).status, 400, 'needs a sender number');
    assert.equal((await api('put', OWNER, '/integrations/twilio', { secrets: { accountSid: SID, authToken: TOKEN }, settings: { smsFrom: '4155550100' } })).status, 400, 'E.164 only');
    assert.equal((await api('put', OWNER, '/integrations/nope', {})).status, 400);
  });

  it('stores secrets encrypted, never returns them, and keeps them when omitted on update', async () => {
    const created = await configureTwilio();
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(!JSON.stringify(created.body).includes(TOKEN));
    assert.equal(created.body.integration.secrets.authToken, '••••3456');
    assert.match(created.body.integration.webhooks.inbound, /^https:\/\/api\.example\.test\/api\/v1\/webhooks\/twilio\/inbound\//);

    const raw = await mongoose.connection.collection('integrations').findOne({ kind: 'twilio' });
    assert.ok(raw.secrets.startsWith('v1.'));
    assert.ok(!raw.secrets.includes(TOKEN) && !JSON.stringify(raw).includes(TOKEN), 'ciphertext only in the database');

    const updated = await api('put', OWNER, '/integrations/twilio', { settings: { smsFrom: '+14155550100', whatsappFrom: '+14155550101' } });
    assert.equal(updated.status, 200);
    const list = (await api('get', OWNER, '/integrations')).body;
    assert.ok(!JSON.stringify(list).includes(TOKEN));
    assert.equal(list.channels.sms.configured, true);
    assert.equal(list.channels.whatsapp.configured, true);
    assert.equal(list.channels.email.configured, false, 'no SMTP anywhere');
    assert.equal((await api('get', GLOBEX, '/integrations')).body.data.length, 0, 'tenant isolation');
  });

  it('tests the connection against the provider and records the real result', async () => {
    const ok = await api('post', OWNER, '/integrations/twilio/test');
    assert.equal(ok.body.ok, true);
    assert.match(ok.body.detail, /Acme Twilio/);
    assert.ok(calls.some((c) => c.url.endsWith(`${SID}.json`) && c.init.headers.Authorization.startsWith('Basic ')));

    await api('put', OWNER, '/integrations/slack', { secrets: { webhookUrl: 'https://hooks.slack.com/services/T000/B000/secret' } }).expect(201);
    assert.equal((await api('post', OWNER, '/integrations/slack/test')).body.ok, true);
    assert.ok(calls.some((c) => c.url === 'https://hooks.slack.com/services/T000/B000/secret' && JSON.parse(c.init.body).text.includes('Test message')));

    setFetch(async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ code: 20003, message: 'Authenticate' }) }));
    const bad = await api('post', OWNER, '/integrations/twilio/test');
    assert.equal(bad.body.ok, false);
    assert.match(bad.body.error, /20003/);
    assert.equal((await api('get', OWNER, '/integrations')).body.data.find((i) => i.kind === 'twilio').status.ok, false, 'the failure is stored');
    setFetch(fakeNetwork);

    const rotated = await api('post', OWNER, '/integrations/twilio/rotate-secret');
    assert.equal(rotated.body.webhookSecret.length, 48);
    assert.equal((await api('delete', OWNER, '/integrations/slack')).status, 204);
    assert.equal((await api('delete', OWNER, '/integrations/slack')).status, 404);
  });
});

describe('sending messages', () => {
  it('refuses to send, and records nothing, when the channel is not configured', async () => {
    const before = await Interaction.countDocuments({});
    const res = await api('post', OWNER, rec('/messages'), { channel: 'email', to: 'ada@example.com', subject: 'Hi', body: 'Hello' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NOT_CONFIGURED');
    assert.match(res.body.error.message, /Email is not set up/);
    assert.equal(await Interaction.countDocuments({}), before, 'no fake "sent" entry is created');
  });

  it('validates recipients, permissions and tenant access', async () => {
    assert.equal((await api('post', OWNER, rec('/messages'), { channel: 'sms', to: 'not-a-number', body: 'x' })).status, 400);
    assert.equal((await api('post', OWNER, rec('/messages'), { channel: 'sms', to: '+14155550123', body: '   ' })).status, 400);
    assert.equal((await api('post', VIEWER, rec('/messages'), { channel: 'sms', to: '+14155550123', body: 'hi' })).status, 403);
    assert.equal((await api('post', GLOBEX, rec('/messages'), { channel: 'sms', to: '+14155550123', body: 'hi' })).status, 404);
    assert.equal((await api('post', OWNER, rec('/messages'), { channel: 'fax', to: 'x', body: 'hi' })).status, 400);
  });

  it('queues an SMS, fills in record variables, and marks it sent only after Twilio accepts it', async () => {
    const res = await api('post', MEMBER, rec('/messages'), { channel: 'sms', to: '+1 (415) 555-0123', body: 'Hi {{name}}, your status is {{status}}. {{record.label}} / {{user.name}}' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.interaction.status, 'queued');
    assert.equal(res.body.interaction.to, '+14155550123', 'normalised to E.164');
    await drain();
    const timeline = (await api('get', VIEWER, rec('/interactions'))).body;
    const sms = timeline.data.find((i) => i._id === res.body.interaction._id);
    assert.equal(sms.status, 'sent');
    assert.ok(sms.providerId.startsWith('SM'));
    assert.equal(sms.body, 'Hi Ada Lovelace, your status is Customer. Ada Lovelace / Jordan Lee');
    const call = calls.filter((c) => c.url.endsWith('/Messages.json')).at(-1);
    const form = new URLSearchParams(call.init.body);
    assert.equal(form.get('To'), '+14155550123');
    assert.equal(form.get('From'), '+14155550100');
    assert.equal(form.get('StatusCallback').startsWith('https://api.example.test/api/v1/webhooks/twilio/status/'), true);
    assert.equal(call.init.headers.Authorization, `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`);
    assert.equal(timeline.channels.sms.configured, true);
  });

  it('sends WhatsApp with the whatsapp: prefix', async () => {
    await api('post', OWNER, rec('/messages'), { channel: 'whatsapp', to: '+14155550123', body: 'Hello on WhatsApp' }).expect(201);
    await drain();
    const form = new URLSearchParams(calls.filter((c) => c.url.endsWith('/Messages.json')).at(-1).init.body);
    assert.equal(form.get('To'), 'whatsapp:+14155550123');
    assert.equal(form.get('From'), 'whatsapp:+14155550101');
  });

  it('retries failures with backoff and finally marks the message failed with the provider error', async () => {
    twilioStatus = 400;
    const res = await api('post', OWNER, rec('/messages'), { channel: 'sms', to: '+14155550123', body: 'This will fail' });
    const id = res.body.interaction._id;
    let hour = 0;
    for (let i = 0; i < 6; i++) await drain({ now: () => new Date(Date.now() + (++hour) * 3600e3) });
    const failed = await Interaction.findById(id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /21211|Invalid To number/);
    twilioStatus = 200;
    assert.equal(calls.filter((c) => c.init.body?.toString().includes('This+will+fail')).length, 4, 'four attempts, then it gives up');
  });

  it('sends email through the configured transport with a safe sender and sanitised subject', async () => {
    const sent = [];
    setMailer({ send: async (m) => { sent.push(m); return { messageId: '<abc@mail>' }; } });
    const res = await api('post', MEMBER, rec('/messages'), { channel: 'email', to: 'ADA@Example.com', subject: 'Hello {{name}}\r\nBcc: evil@example.com', body: 'Dear {{name}},\n\nThanks.' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await drain();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ada@example.com');
    assert.equal(sent[0].subject, 'Hello Ada Lovelace Bcc: evil@example.com', 'line breaks removed: no header injection');
    assert.match(sent[0].from, /^"Jordan Lee \(via OrgCRM\)" <.+>$/);
    assert.equal(sent[0].replyTo, 'member@acme.test');
    assert.equal(sent[0].text, 'Dear Ada Lovelace,\n\nThanks.');
    assert.equal((await Interaction.findById(res.body.interaction._id)).status, 'sent');
    setMailer(null);
  });

  it('renders templates server-side and previews them', async () => {
    const t = await api('post', MEMBER, `/communications/templates?workspaceId=${ws._id}`, { name: 'Follow up', channel: 'sms', body: 'Hi {{name}}, just checking in.' });
    assert.equal(t.status, 201);
    assert.equal((await api('post', VIEWER, `/communications/templates?workspaceId=${ws._id}`, { name: 'x', channel: 'sms', body: 'x' })).status, 403);
    assert.equal((await api('get', VIEWER, `/communications/templates?workspaceId=${ws._id}`)).body.data.length, 1);
    assert.equal((await api('get', GLOBEX, `/communications/templates?workspaceId=${ws._id}`)).status, 404);
    const preview = await api('post', MEMBER, '/communications/render', { dataformId: contacts._id, recordId: record._id, body: t.body.template.body });
    assert.equal(preview.body.body, 'Hi Ada Lovelace, just checking in.');
    const sent = await api('post', MEMBER, rec('/messages'), { channel: 'sms', to: '+14155550123', templateId: t.body.template._id });
    assert.equal(sent.body.interaction.body, 'Hi Ada Lovelace, just checking in.');
    assert.equal((await api('delete', MEMBER, `/communications/templates/${t.body.template._id}`)).status, 204);
  });

  it('logs calls and notes, and protects sent messages from deletion', async () => {
    const call = await api('post', MEMBER, rec('/interactions'), { channel: 'call', direction: 'inbound', body: 'Asked about pricing', outcome: 'Interested', durationSec: 340 });
    assert.equal(call.status, 201);
    assert.equal(call.body.interaction.status, 'logged');
    assert.equal(call.body.interaction.durationSec, 340);
    assert.equal((await api('post', VIEWER, rec('/interactions'), { channel: 'note', body: 'x' })).status, 403);
    assert.equal((await api('post', MEMBER, rec('/interactions'), { channel: 'call', body: 'x', durationSec: -5 })).status, 400);
    const sms = (await api('get', MEMBER, rec('/interactions'))).body.data.find((i) => i.channel === 'sms');
    assert.equal((await api('delete', OWNER, rec(`/interactions/${sms._id}`))).status, 403, 'messages are part of the record');
    assert.equal((await api('delete', OWNER, rec(`/interactions/${call.body.interaction._id}`))).status, 204, 'workspace admin may remove a log entry');
  });
});

describe('provider webhooks', () => {
  let integrationId;
  const post = (path, params, { signed = true, sig } = {}) => {
    const url = `https://api.example.test/api/v1/webhooks/${path}`;
    const r = request(app).post(`/api/v1/webhooks/${path}`).type('form');
    if (signed) r.set('X-Twilio-Signature', sig ?? signFor(TOKEN, url, params));
    return r.send(params);
  };
  before(async () => { integrationId = String((await mongoose.connection.collection('integrations').findOne({ kind: 'twilio' }))._id); });

  it('verifies the Twilio signature before touching any data', async () => {
    const sent = await Interaction.findOne({ channel: 'sms', status: 'sent' });
    const params = { MessageSid: sent.providerId, MessageStatus: 'delivered' };
    assert.equal((await post(`twilio/status/${integrationId}`, params, { signed: false })).status, 403);
    assert.equal((await post(`twilio/status/${integrationId}`, params, { sig: 'AAAA' })).status, 403);
    assert.equal((await Interaction.findById(sent._id)).status, 'sent');
    assert.equal((await post(`twilio/status/${integrationId}`, params)).status, 204);
    assert.equal((await Interaction.findById(sent._id)).status, 'delivered');
    assert.equal((await post(`twilio/status/${'0'.repeat(24)}`, params)).status, 404);
  });

  it('never moves a delivered message backwards and records provider failures', async () => {
    const delivered = await Interaction.findOne({ channel: 'sms', status: 'delivered' });
    await post(`twilio/status/${integrationId}`, { MessageSid: delivered.providerId, MessageStatus: 'failed', ErrorCode: '30008' });
    assert.equal((await Interaction.findById(delivered._id)).status, 'delivered');
    const other = await Interaction.findOne({ channel: 'whatsapp', status: 'sent' });
    await post(`twilio/status/${integrationId}`, { MessageSid: other.providerId, MessageStatus: 'undelivered', ErrorCode: '30003' });
    const after = await Interaction.findById(other._id);
    assert.equal(after.status, 'failed');
    assert.match(after.error, /30003/);
  });

  it('files inbound SMS on the record whose phone matches, and ignores unknown senders', async () => {
    const before = await Interaction.countDocuments({ direction: 'inbound' });
    const res = await post(`twilio/inbound/${integrationId}`, { From: '+14155550123', To: '+14155550100', Body: 'Yes, call me tomorrow', MessageSid: 'SMin1' });
    assert.equal(res.status, 200);
    assert.equal(res.text, '<Response/>');
    const timeline = (await api('get', OWNER, rec('/interactions'))).body.data;
    const inbound = timeline.find((i) => i.direction === 'inbound' && i.channel === 'sms');
    assert.equal(inbound.body, 'Yes, call me tomorrow');
    assert.equal(inbound.status, 'received');
    const notes = (await api('get', OWNER, '/notifications?limit=30')).body.data;
    assert.ok(notes.some((n) => n.type === 'message_received' && n.title.includes('Ada Lovelace')), 'followers are told');

    await post(`twilio/inbound/${integrationId}`, { From: 'whatsapp:+14155550123', Body: 'Hola', MessageSid: 'SMin2' });
    assert.equal((await Interaction.findOne({ providerId: 'SMin2' })).channel, 'whatsapp');
    await post(`twilio/inbound/${integrationId}`, { From: '+19995550000', Body: 'Who is this', MessageSid: 'SMin3' });
    assert.equal(await Interaction.countDocuments({ providerId: 'SMin3' }), 0);
    assert.equal(await Interaction.countDocuments({ direction: 'inbound' }), before + 2);
    assert.equal((await post(`twilio/inbound/${integrationId}`, { From: '+14155550123', Body: 'forged' }, { sig: 'forged' })).status, 403);
  });

  it('accepts inbound email only with the shared secret', async () => {
    const created = await api('put', OWNER, '/integrations/smtp', { secrets: { url: 'smtps://user:pass@smtp.example.com:465' }, settings: { from: 'Acme <crm@acme.example>' } });
    assert.equal(created.status, 201);
    const secret = created.body.webhookSecret;
    const path = `/api/v1/webhooks/inbound-email/${created.body.integration.id}`;
    const body = { from: 'Ada <ada@example.com>', subject: 'Re: pricing', text: 'Please send the quote.' };
    assert.equal((await request(app).post(path).send(body)).status, 403);
    assert.equal((await request(app).post(path).set('X-Webhook-Secret', 'wrong').send(body)).status, 403);
    const ok = await request(app).post(path).set('X-Webhook-Secret', secret).send(body);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const entry = (await api('get', OWNER, rec('/interactions'))).body.data.find((i) => i.channel === 'email' && i.direction === 'inbound');
    assert.equal(entry.subject, 'Re: pricing');
    assert.equal((await request(app).post(path).set('X-Webhook-Secret', secret).send({ from: 'nobody@nowhere.example', text: 'x' })).status, 202, 'unmatched mail is not filed');
    assert.equal((await request(app).post(path).set('X-Webhook-Secret', secret).send({ subject: 'no sender' })).status, 400);
    assert.equal((await api('get', OWNER, '/communications/channels')).body.channels.email.source, 'account');
    await api('delete', OWNER, '/integrations/smtp').expect(204);
    assert.equal(followerOnly._id.length, 24);
  });
});

import './_env.js';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let mongod; let app; let drain; let runDueWorkflows; let setFetch; let setLookup; let setMailer; let Task; let Comment; let WorkflowExecution;
const tokens = {}; const ids = {};
const OWNER = 'owner@acme.test'; const MEMBER = 'member@acme.test'; const VIEWER = 'viewer@acme.test'; const TAYLOR = 'taylor@acme.test'; const GLOBEX = 'owner@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};

let ws; let deals; let companies; let contacts; let tickets;
const calls = [];
let webhookStatus = 200;
const network = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, init });
  if (u.startsWith('https://hooks.example.com/')) return { ok: webhookStatus < 400, status: webhookStatus, text: async () => 'ok', json: async () => ({}) };
  if (u.startsWith('https://hooks.slack.com/')) return { ok: true, status: 200, text: async () => 'ok' };
  if (u.includes('api.twilio.com')) return { ok: true, status: 201, json: async () => ({ sid: `SM${calls.length}`, status: 'queued' }) };
  return { ok: false, status: 404, statusText: 'nope', json: async () => ({}), text: async () => '' };
};
const webhookCalls = () => calls.filter((c) => c.url.startsWith('https://hooks.example.com/'));

const settle = async () => { for (let k = 0; k < 6; k++) await drain({ now: () => new Date(Date.now() + k * 2 * 3600e3) }); };
const wf = (body) => api('post', OWNER, '/workflows', { dataformId: deals._id, description: '', actions: [], conditions: null, ...body });
const enable = (id, enabled = true) => api('patch', OWNER, `/workflows/${id}/enabled`, { enabled }).expect(200);
const remove = (id) => api('delete', OWNER, `/workflows/${id}`).expect(204);
const deal = (data, who = OWNER) => api('post', who, `/dataforms/${deals._id}/records`, { data: { title: 'Deal', ...data } });
const eq = (f, value) => ({ kind: 'field', field: f, operator: 'eq', value });
const executions = async (id, q = '') => (await api('get', OWNER, `/workflows/${id}/executions${q}`)).body;
const notes = async (who, type) => (await api('get', who, '/notifications?limit=50')).body.data.filter((n) => !type || n.type === type);

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ drain } = await import('../src/modules/queue/queue.js'));
  ({ runDueWorkflows } = await import('../src/modules/workflows/engine.js'));
  ({ setFetch, setLookup } = await import('../src/providers/http.js'));
  ({ setMailer } = await import('../src/providers/email.js'));
  ({ Task } = await import('../src/modules/tasks/task.model.js'));
  ({ Comment } = await import('../src/modules/comments/comment.model.js'));
  ({ WorkflowExecution } = await import('../src/modules/workflows/workflow.model.js'));
  await seed();
  for (const name of ['Notification', 'Task', 'TaskActivity', 'Comment', 'Follow']) await mongoose.model(name).deleteMany({});
  await mongoose.syncIndexes();
  app = createApp();
  setFetch(network);
  setLookup(async () => [{ address: '93.184.216.34' }]);
  setMailer(null);
  for (const who of [OWNER, MEMBER, VIEWER, TAYLOR, GLOBEX]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' });
    tokens[who] = res.body.accessToken; ids[who] = res.body.user._id;
  }
  ws = (await api('post', OWNER, '/workspaces', { name: 'Automation space' })).body.workspace;
  const mk = async (name, templateId) => (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name, templateId })).body.dataform;
  deals = await mk('Deals', 'deals'); companies = await mk('Companies', 'companies'); contacts = await mk('Contacts', 'contacts'); tickets = await mk('Tickets', 'tickets');
  await api('post', OWNER, `/dataforms/${contacts._id}/fields`, { key: 'company', label: 'Company', type: 'relationship', config: { targetDataform: companies._id } }).expect(201);
});

after(async () => {
  setFetch(undefined); setLookup(undefined); setMailer(undefined);
  await mongoose.disconnect();
  await mongod.stop();
});

describe('workflow definitions', () => {
  const base = { name: 'Rule', trigger: { type: 'post_save' } };
  const bad = async (body, re) => {
    const res = await wf({ ...base, ...body });
    assert.equal(res.status, 400, JSON.stringify(res.body).slice(0, 300));
    if (re) assert.match(JSON.stringify(res.body), re);
  };

  it('is limited to workspace admins and isolated per tenant', async () => {
    const ok = await wf({ ...base, name: 'Starter', actions: [{ type: 'comment', body: 'Hi' }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.workflow.enabled, false, 'new workflows start paused');
    for (const who of [MEMBER, VIEWER]) {
      assert.equal((await api('post', who, '/workflows', { ...base, dataformId: deals._id, actions: [] })).status, 403);
      assert.equal((await api('get', who, `/workflows/${ok.body.workflow._id}`)).status, 403);
    }
    assert.equal((await api('get', GLOBEX, `/workflows/${ok.body.workflow._id}`)).status, 404);
    assert.equal((await api('post', GLOBEX, '/workflows', { ...base, dataformId: deals._id, actions: [] })).status, 404);
    await remove(ok.body.workflow._id);
  });

  it('rejects conditions that do not match the dataform', async () => {
    await bad({ conditions: { op: 'and', conditions: [eq('ghost', 'x')] } }, /Unknown field: ghost/);
    await bad({ conditions: { op: 'and', conditions: [{ kind: 'field', field: 'value', operator: 'contains', value: '5' }] } }, /does not apply to decimal/);
    await bad({ conditions: { op: 'and', conditions: [eq('stage', 'nonsense')] } }, /allowed options/);
    await bad({ conditions: { op: 'and', conditions: [{ kind: 'formula', expression: '{value} >' }] } }, /ends unexpectedly/);
    await bad({ conditions: { op: 'and', conditions: [{ kind: 'formula', expression: '{nope} > 1' }] } }, /Unknown field \{nope\}/);
    await bad({ trigger: { type: 'manual' }, conditions: { op: 'and', conditions: [{ kind: 'changed', field: 'stage' }] } }, /needs a save trigger/);
    let deep = { op: 'and', conditions: [eq('stage', 'won')] };
    for (let i = 0; i < 4; i++) deep = { op: 'and', conditions: [deep] };
    await bad({ conditions: deep }, /nested too deeply/);
    const multi = await wf({ ...base, conditions: { op: 'and', conditions: [{ kind: 'field', field: 'won', operator: 'isTrue' }] }, actions: [{ type: 'comment', body: 'x' }] });
    assert.equal(multi.status, 201, 'valid conditions are accepted');
    await remove(multi.body.workflow._id);
  });

  it('rejects actions that cannot run on the chosen trigger or are unsafe', async () => {
    await bad({ trigger: { type: 'pre_save' }, actions: [{ type: 'notify', recipients: { mode: 'creator' }, title: 'x' }] }, /cannot run before a record is saved/);
    await bad({ trigger: { type: 'pre_delete' }, actions: [{ type: 'set_field', field: 'title', value: 'x' }] }, /cannot run before/);
    await bad({ trigger: { type: 'post_save' }, actions: [{ type: 'validation_error', message: 'no' }] }, /only block a save or delete/);
    await bad({ actions: [{ type: 'set_field', field: 'ghost', value: 'x' }] }, /Unknown field: ghost/);
    await bad({ actions: [{ type: 'set_field', field: 'value', value: 'abc' }] }, /Must be a number/);
    await bad({ actions: [{ type: 'set_field', field: 'value', mode: 'formula', expression: '{value} +' }] });
    await bad({ actions: [{ type: 'set_field', field: 'value', mode: 'formula' }] }, /Enter a formula/);
    await bad({ actions: [{ type: 'send_email', to: { mode: 'field', field: 'title' }, subject: 's', body: 'b' }] }, /Choose an email field/);
    await bad({ actions: [{ type: 'send_sms', to: { mode: 'fixed', address: '12345' }, body: 'b' }] }, /international format/);
    await bad({ actions: [{ type: 'notify', recipients: { mode: 'users', users: [] }, title: 'x' }] }, /at least one person/);
    await bad({ actions: [{ type: 'create_record', dataformId: '0'.repeat(24), values: [] }] }, /Choose a dataform in this workspace/);
    await bad({ actions: Array.from({ length: 11 }, () => ({ type: 'comment', body: 'x' })) });
    await bad({ actions: [{ type: 'run_code', code: 'process.exit()' }] });
    await bad({ trigger: { type: 'schedule', schedule: { frequency: 'daily', timezone: 'Mars/Base' } } });
  });

  it('blocks webhook URLs that would reach internal networks', async () => {
    for (const url of ['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://user:pw@hooks.example.com/x']) {
      await bad({ actions: [{ type: 'webhook', url }] }, /https|private|credentials/);
    }
    setLookup(async () => [{ address: '10.0.0.8' }]);
    await bad({ actions: [{ type: 'webhook', url: 'https://sneaky.example.com/x' }] }, /private or internal/);
    setLookup(async () => [{ address: '93.184.216.34' }]);
    const ok = await wf({ ...base, actions: [{ type: 'webhook', url: 'https://hooks.example.com/ok' }] });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.workflow.webhookSecret.length, 48, 'the signing secret is shown to the admin');
    assert.equal((await api('get', OWNER, `/workflows/${ok.body.workflow._id}`)).body.workflow.webhookSecret, ok.body.workflow.webhookSecret);
    await remove(ok.body.workflow._id);
  });

  it('checks child-field and create-record targets', async () => {
    await bad({ dataformId: companies._id, actions: [{ type: 'set_child_field', childDataformId: contacts._id, relationField: 'name', field: 'status', value: 'lead' }] }, /relationship field/);
    await bad({ dataformId: deals._id, actions: [{ type: 'set_child_field', childDataformId: contacts._id, relationField: 'company', field: 'status', value: 'lead' }] }, /links to Deals/);
    await bad({ dataformId: companies._id, actions: [{ type: 'set_child_field', childDataformId: contacts._id, relationField: 'company', field: 'ghost', value: 'x' }] }, /Unknown field in Contacts/);
    await bad({ actions: [{ type: 'create_record', dataformId: tickets._id, values: [{ field: 'priority', value: 'extreme' }] }] }, /allowed options/);
  });
});

describe('before-save rules block and adjust records', () => {
  let rule; let deleteRule;
  const WON_LOW = { op: 'and', conditions: [eq('stage', 'won'), { kind: 'formula', expression: '{value} < 1000' }] };

  it('lets everything through while the rule is paused', async () => {
    const res = await wf({
      name: 'Won deals need value', trigger: { type: 'pre_save', events: ['create', 'update'] }, conditions: WON_LOW,
      actions: [{ type: 'validation_error', message: 'A won deal ("{{title}}") needs a value of at least 1,000. It is {{value}}.' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    rule = res.body.workflow;
    assert.equal((await deal({ title: 'Paused rule deal', stage: 'won', value: 5 })).status, 201);
  });

  it('blocks creating and editing records that break the rule, with the rule\'s own message', async () => {
    await enable(rule._id);
    const blocked = await deal({ title: 'Cheap win', stage: 'won', value: 5 });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.error.code, 'WORKFLOW_VALIDATION');
    assert.equal(blocked.body.error.message, 'A won deal ("Cheap win") needs a value of at least 1,000. It is 5.');
    assert.equal((await deal({ title: 'Cheap loss', stage: 'lost', value: 5 })).status, 201, 'other records are unaffected');
    assert.equal((await deal({ title: 'Big win', stage: 'won', value: 5000 })).status, 201);

    const d = (await deal({ title: 'Qualified', stage: 'qualified', value: 10 })).body.record;
    const patch = (data) => api('patch', OWNER, `/dataforms/${deals._id}/records/${d._id}`, { data });
    assert.equal((await patch({ stage: 'won' })).status, 400, 'an edit that makes it break the rule');
    assert.equal((await patch({ stage: 'won', value: 5000 })).status, 200);
    assert.equal((await patch({ value: 10 })).status, 400, 'lowering the value of a won deal');
    assert.equal((await api('get', OWNER, `/dataforms/${deals._id}/records/${d._id}`)).body.record.data.value, 5000, 'nothing was saved');
  });

  it('applies to Kanban moves, copies and bulk edits, which cannot be used to sidestep it', async () => {
    const a = (await deal({ title: 'Move me', stage: 'qualified', value: 10 })).body.record;
    const b = (await deal({ title: 'Bulk me', stage: 'qualified', value: 20 })).body.record;
    assert.equal((await api('post', OWNER, `/dataforms/${deals._id}/records/${a._id}/move`, { field: 'stage', value: 'won' })).status, 400);
    const bulk = await api('post', OWNER, `/dataforms/${deals._id}/records/bulk`, { action: 'update', ids: [a._id, b._id], data: { stage: 'won' } });
    assert.equal(bulk.status, 400);
    for (const r of [a, b]) assert.equal((await api('get', OWNER, `/dataforms/${deals._id}/records/${r._id}`)).body.record.data.stage, 'qualified', 'a blocked bulk edit changes nothing');
    const winner = (await deal({ title: 'Copy source', stage: 'won', value: 5000 })).body.record;
    assert.equal((await api('post', OWNER, `/dataforms/${deals._id}/records/${winner._id}/copy`)).status, 201, 'the copy keeps a valid value');
    const ok = await api('post', OWNER, `/dataforms/${deals._id}/records/bulk`, { action: 'update', ids: [a._id, b._id], data: { stage: 'lost' } });
    assert.equal(ok.body.affected, 2);
  });

  it('records blocked attempts in the run history, and stops enforcing when paused', async () => {
    const history = await executions(rule._id, '?status=blocked');
    assert.ok(history.total >= 4, `blocked runs: ${history.total}`);
    assert.match(history.data[0].error, /needs a value/);
    assert.equal(history.data[0].trigger, 'pre_save');
    await enable(rule._id, false);
    assert.equal((await deal({ title: 'After pause', stage: 'won', value: 1 })).status, 201);
    await remove(rule._id);
  });

  it('can protect records from deletion, single and bulk', async () => {
    deleteRule = (await wf({ name: 'Keep won deals', trigger: { type: 'pre_delete' }, conditions: { op: 'and', conditions: [eq('stage', 'won')] }, actions: [{ type: 'validation_error', message: 'Won deals cannot be deleted. Archive them instead.' }] })).body.workflow;
    await enable(deleteRule._id);
    const won = (await deal({ title: 'Delete: won', stage: 'won', value: 5000 })).body.record;
    const open = (await deal({ title: 'Delete: open', stage: 'qualified' })).body.record;
    const open2 = (await deal({ title: 'Delete: open 2', stage: 'qualified' })).body.record;
    const del = await api('delete', OWNER, `/dataforms/${deals._id}/records/${won._id}`);
    assert.equal(del.status, 400);
    assert.match(del.body.error.message, /cannot be deleted/);
    const bulk = await api('post', OWNER, `/dataforms/${deals._id}/records/bulk`, { action: 'delete', ids: [open._id, won._id] });
    assert.equal(bulk.status, 400);
    assert.equal((await api('get', OWNER, `/dataforms/${deals._id}/records/${open._id}`)).status, 200, 'one blocked record stops the whole batch');
    assert.equal((await api('delete', OWNER, `/dataforms/${deals._id}/records/${open2._id}`)).status, 204);
    await remove(deleteRule._id);
  });
});

describe('before-save rules compute values', () => {
  it('sets values from formulas, including read-only fields users cannot edit', async () => {
    const f = (await api('get', OWNER, `/dataforms/${deals._id}`)).body.fields.find((x) => x.key === 'won');
    await api('patch', OWNER, `/dataforms/${deals._id}/fields/${f._id}`, { readOnly: true }).expect(200);
    const w = (await wf({ name: 'Mirror stage', trigger: { type: 'pre_save' }, actions: [{ type: 'set_field', field: 'won', mode: 'formula', expression: '{stage} = "won"' }] })).body.workflow;
    await enable(w._id);
    const user = await deal({ title: 'Direct', stage: 'qualified', won: true });
    assert.equal(user.status, 400, 'users still cannot write read-only fields');
    const created = (await deal({ title: 'Computed', stage: 'won', value: 5000 })).body.record;
    assert.equal(created.data.won, true);
    const updated = await api('patch', OWNER, `/dataforms/${deals._id}/records/${created._id}`, { data: { stage: 'lost' } });
    assert.equal(updated.body.record.data.won, false);
    const hist = (await api('get', OWNER, `/dataforms/${deals._id}/records/${created._id}/history`)).body.data;
    assert.ok(hist[0].changes.some((c) => c.field === 'won'), 'the computed change is part of the audit trail');
    await remove(w._id);
  });

  it('never blocks a save because a rule itself is broken: the failure goes to the run history', async () => {
    const w = (await wf({ name: 'Broken math', trigger: { type: 'pre_save' }, actions: [{ type: 'set_field', field: 'value', mode: 'formula', expression: '100 / ({value} - {value})' }] })).body.workflow;
    await enable(w._id);
    const res = await deal({ title: 'Survives', value: 7 });
    assert.equal(res.status, 201);
    assert.equal(res.body.record.data.value, 7, 'the value was left alone');
    const history = await executions(w._id);
    assert.equal(history.data[0].status, 'failed');
    assert.match(history.data[0].actions[0].detail, /Division by zero/);
    await remove(w._id);
  });

  it('refuses to set a required field to empty', async () => {
    const w = (await wf({ name: 'Clear title', trigger: { type: 'pre_save', events: ['create'] }, actions: [{ type: 'set_field', field: 'title', value: '' }] })).body.workflow;
    await enable(w._id);
    const res = await deal({ title: 'Keeps its title' });
    assert.equal(res.body.record.data.title, 'Keeps its title');
    assert.match((await executions(w._id)).data[0].actions[0].detail, /required/);
    await remove(w._id);
  });
});

describe('after-save workflows run in the background', () => {
  let flow; let record; let secret;
  const WON = { op: 'and', conditions: [{ kind: 'changed', field: 'stage' }, eq('stage', 'won')] };

  it('queues a run only when the conditions match, then performs every action', async () => {
    const created = await wf({
      name: 'When a deal is won', trigger: { type: 'post_save', events: ['update'] }, conditions: WON,
      actions: [
        { type: 'notify', recipients: { mode: 'users', users: [ids[MEMBER]] }, title: 'Deal won: {{title}}', body: 'Worth {{value}} · {{record.url}}' },
        { type: 'create_task', title: 'Send contract for {{title}}', assignees: { mode: 'users', users: [ids[MEMBER]] }, dueInDays: 2, priority: 'high' },
        { type: 'comment', body: 'Congratulations on {{title}}! ({{stage}})' },
        { type: 'set_field', field: 'close_date', mode: 'formula', expression: 'TODAY()' },
        { type: 'webhook', url: 'https://hooks.example.com/orgcrm', includeRecord: true },
      ],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    flow = created.body.workflow; secret = flow.webhookSecret;
    await enable(flow._id);

    record = (await deal({ title: 'Mega deal', stage: 'qualified', value: 25000 })).body.record;
    await drain();
    assert.equal((await executions(flow._id)).total, 0, 'creating the deal does not match an update-only workflow');
    await api('patch', OWNER, `/dataforms/${deals._id}/records/${record._id}`, { data: { value: 26000 } }).expect(200);
    await drain();
    assert.equal((await executions(flow._id)).total, 0, 'a change to another field does not match');

    await api('patch', OWNER, `/dataforms/${deals._id}/records/${record._id}`, { data: { stage: 'won' } }).expect(200);
    assert.equal((await executions(flow._id)).data[0].status, 'queued', 'the user is not kept waiting: the run is queued');
    await settle();
    const run = (await executions(flow._id)).data[0];
    assert.equal(run.status, 'succeeded', JSON.stringify(run.actions));
    assert.deepEqual(run.actions.map((a) => a.status), ['ok', 'ok', 'ok', 'ok', 'ok']);
    assert.equal((await executions(flow._id)).total, 1);
  });

  it('delivers the real effects of each action', async () => {
    const n = (await notes(MEMBER, 'workflow'))[0];
    assert.equal(n.title, 'Deal won: Mega deal');
    assert.match(n.body, /Worth 26000 · http/);
    const task = await Task.findOne({ title: 'Send contract for Mega deal' });
    assert.deepEqual(task.assignees.map(String), [ids[MEMBER]]);
    assert.equal(task.priority, 'high');
    assert.equal(String(task.record), record._id);
    assert.ok(task.due > new Date());
    const comment = await Comment.findOne({ record: record._id, body: /Congratulations/ });
    assert.equal(comment.body, 'Congratulations on Mega deal! (Won)');
    const fresh = (await api('get', OWNER, `/dataforms/${deals._id}/records/${record._id}`)).body.record;
    assert.equal(fresh.data.close_date, new Date().toISOString().slice(0, 10), 'TODAY() was written as a date');
    const hist = (await api('get', OWNER, `/dataforms/${deals._id}/records/${record._id}/history`)).body.data;
    assert.ok(hist.some((h) => h.workflow && h.changes.some((c) => c.field === 'close_date')), 'workflow changes are attributed to the workflow');
  });

  it('signs webhooks so receivers can verify them', async () => {
    const [call] = webhookCalls();
    assert.equal(call.url, 'https://hooks.example.com/orgcrm');
    assert.equal(call.init.redirect, 'manual', 'redirects are never followed');
    const h = call.init.headers;
    const expected = crypto.createHmac('sha256', secret).update(`${h['X-OrgCRM-Timestamp']}.${call.init.body}`).digest('hex');
    assert.equal(h['X-OrgCRM-Signature'], `sha256=${expected}`);
    const body = JSON.parse(call.init.body);
    assert.equal(body.event, 'update');
    assert.equal(body.workflow.name, 'When a deal is won');
    assert.equal(body.record.data.title, 'Mega deal');
    assert.equal(body.record.data.stage, 'won');
    assert.equal(h['X-OrgCRM-Delivery'], body.id);
    const rotated = (await api('post', OWNER, `/workflows/${flow._id}/rotate-secret`)).body.webhookSecret;
    assert.notEqual(rotated, secret);
  });

  it('does not run twice for the same change, and a workflow editing its own record does not loop', async () => {
    const before = (await executions(flow._id)).total;
    await settle();
    assert.equal((await executions(flow._id)).total, before, 'close_date was set by this workflow and did not re-trigger it');
    await remove(flow._id);
  });
});

describe('retries and failures', () => {
  const create = (body) => wf({ trigger: { type: 'post_save', events: ['create'] }, ...body }).then((r) => { assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.workflow; });

  it('resumes at the failed action, so finished steps are never repeated', async () => {
    const w = await create({
      name: 'Task then webhook',
      actions: [{ type: 'create_task', title: 'Only once', assignees: { mode: 'creator' } }, { type: 'webhook', url: 'https://hooks.example.com/flaky' }],
    });
    await enable(w._id);
    webhookStatus = 500;
    const calls0 = webhookCalls().length;
    await deal({ title: 'Flaky' });
    await drain();
    let run = (await executions(w._id)).data[0];
    assert.equal(run.status, 'queued', 'waiting for a retry');
    assert.deepEqual(run.actions.map((a) => a.status), ['ok', 'failed']);
    assert.match(run.error, /responded with 500/);
    webhookStatus = 200;
    await settle();
    run = (await executions(w._id)).data[0];
    assert.equal(run.status, 'succeeded');
    assert.equal(await Task.countDocuments({ title: 'Only once' }), 1, 'the task was not created again on retry');
    assert.equal(webhookCalls().length - calls0, 2, 'one failed delivery, one successful');
    assert.ok(run.attempts >= 2);
    await remove(w._id);
  });

  it('gives up after the retry limit, tells the workflow owner, and can be retried by an admin', async () => {
    const w = await create({ name: 'Always failing', actions: [{ type: 'create_task', title: 'Not duplicated', assignees: { mode: 'creator' } }, { type: 'webhook', url: 'https://hooks.example.com/down' }] });
    await enable(w._id);
    webhookStatus = 503;
    await deal({ title: 'Doomed' });
    await settle();
    let run = (await executions(w._id)).data[0];
    assert.equal(run.status, 'failed');
    assert.equal(run.attempts, 4);
    const alert = (await notes(OWNER, 'workflow_failed'))[0];
    assert.equal(alert.title, 'Workflow "Always failing" failed');
    assert.match(alert.body, /503/);
    assert.equal((await api('post', MEMBER, `/workflows/executions/${run._id}/retry`)).status, 403);

    webhookStatus = 200;
    assert.equal((await api('post', OWNER, `/workflows/executions/${run._id}/retry`)).status, 200);
    await settle();
    run = (await api('get', OWNER, `/workflows/executions/${run._id}`)).body.execution;
    assert.equal(run.status, 'succeeded');
    assert.equal(await Task.countDocuments({ title: 'Not duplicated' }), 1);
    assert.equal((await api('post', OWNER, `/workflows/executions/${run._id}/retry`)).status, 409, 'only failed runs can be retried');
    await remove(w._id);
  });

  it('can continue past a failing action and report a partial result', async () => {
    const w = await create({
      name: 'Continue on error', onError: 'continue',
      actions: [{ type: 'slack', text: 'Hello' }, { type: 'notify', recipients: { mode: 'users', users: [ids[TAYLOR]] }, title: 'Still ran' }],
    });
    await enable(w._id);
    await deal({ title: 'Partial' });
    await drain();
    const run = (await executions(w._id)).data[0];
    assert.equal(run.status, 'partial');
    assert.deepEqual(run.actions.map((a) => a.status), ['failed', 'ok']);
    assert.match(run.actions[0].detail, /Slack is not connected/);
    assert.equal((await notes(TAYLOR, 'workflow'))[0].title, 'Still ran');
    await remove(w._id);
  });

  it('cancels a run that was queued before the workflow was paused or deleted', async () => {
    const w = await create({ name: 'Paused midway', actions: [{ type: 'comment', body: 'never posted' }] });
    await enable(w._id);
    const rec = (await deal({ title: 'Cancelled run' })).body.record;
    await enable(w._id, false);
    await drain();
    assert.equal((await executions(w._id)).data[0].status, 'cancelled');
    assert.equal(await Comment.countDocuments({ record: rec._id }), 0);

    await enable(w._id);
    await deal({ title: 'Second' });
    const cancelled = await api('post', OWNER, `/workflows/${w._id}/cancel-pending`);
    assert.equal(cancelled.body.cancelled, 1);
    await drain();
    assert.equal((await executions(w._id)).data[0].status, 'cancelled');
    await deal({ title: 'Third' });
    await remove(w._id);
    await drain();
    assert.equal((await WorkflowExecution.find({ workflowName: 'Paused midway' })).every((e) => e.status === 'cancelled'), true, 'history survives deletion');
  });
});

describe('loop protection', () => {
  it('stops a workflow from re-triggering itself', async () => {
    const w = (await wf({
      name: 'Self increment', trigger: { type: 'post_save' }, conditions: { op: 'and', conditions: [{ kind: 'formula', expression: '{value} >= 0' }] },
      actions: [{ type: 'set_field', field: 'value', mode: 'formula', expression: '{value} + 1' }],
    })).body.workflow;
    await enable(w._id);
    const rec = (await deal({ title: 'Loop', value: 0 })).body.record;
    await settle();
    const fresh = (await api('get', OWNER, `/dataforms/${deals._id}/records/${rec._id}`)).body.record;
    assert.equal(fresh.data.value, 1, 'it ran once and did not trigger itself');
    const runs = (await executions(w._id)).data;
    assert.ok(runs.some((r) => r.status === 'skipped' && /loop/.test(r.error)));
    await remove(w._id);
  });

  it('breaks cycles between two workflows', async () => {
    const mk = (name, from, to) => wf({ name, trigger: { type: 'post_save' }, conditions: { op: 'and', conditions: [eq('stage', from)] }, actions: [{ type: 'set_field', field: 'stage', value: to }] }).then((r) => r.body.workflow);
    const a = await mk('A: qualified to proposal', 'qualified', 'proposal');
    const b = await mk('B: proposal to qualified', 'proposal', 'qualified');
    await enable(a._id); await enable(b._id);
    const rec = (await deal({ title: 'Ping pong', stage: 'qualified' })).body.record;
    await settle();
    const fresh = (await api('get', OWNER, `/dataforms/${deals._id}/records/${rec._id}`)).body.record;
    assert.equal(fresh.data.stage, 'qualified', 'A moved it to proposal, B moved it back, and A was not allowed to run again');
    const skipped = await WorkflowExecution.countDocuments({ workflow: { $in: [a._id, b._id] }, status: 'skipped' });
    assert.ok(skipped >= 1);
    await remove(a._id); await remove(b._id);
  });

  it('caps chains of different workflows at three levels', async () => {
    const form = (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name: 'Chain' })).body.dataform;
    for (let i = 1; i <= 6; i++) await api('post', OWNER, `/dataforms/${form._id}/fields`, { key: `f${i}`, label: `F${i}`, type: 'text' }).expect(201);
    const flows = [];
    for (let i = 1; i <= 5; i++) {
      flows.push((await wf({ name: `Step ${i}`, dataformId: form._id, trigger: { type: 'post_save' }, conditions: { op: 'and', conditions: [{ kind: 'field', field: `f${i}`, operator: 'notEmpty' }, { kind: 'field', field: `f${i + 1}`, operator: 'empty' }] }, actions: [{ type: 'set_field', field: `f${i + 1}`, value: 'done' }] })).body.workflow);
    }
    for (const f of flows) await enable(f._id);
    const rec = (await api('post', OWNER, `/dataforms/${form._id}/records`, { data: { f1: 'start' } })).body.record;
    await settle();
    const data = (await api('get', OWNER, `/dataforms/${form._id}/records/${rec._id}`)).body.record.data;
    assert.deepEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((k) => !!data[k]), [true, true, true, true, false, false], 'steps 1-3 ran; the 4th level was refused');
    assert.ok(await WorkflowExecution.exists({ status: 'skipped', error: /3 levels deep/ }));
    for (const f of flows) await remove(f._id);
  });
});

describe('record-creating and related-record actions', () => {
  it('updates linked records, creates records elsewhere, and clones', async () => {
    const co = (await api('post', OWNER, `/dataforms/${companies._id}/records`, { data: { name: 'Initech', industry: 'technology' } })).body.record;
    const mkContact = (name) => api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name, company: co._id, status: 'lead' } }).then((r) => r.body.record);
    const [c1, c2] = [await mkContact('One'), await mkContact('Two')];
    const loner = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Unlinked', status: 'lead' } })).body.record;

    const child = (await wf({
      name: 'Company industry changed', dataformId: companies._id, trigger: { type: 'post_save', events: ['update'] }, conditions: { op: 'and', conditions: [{ kind: 'changed', field: 'industry' }] },
      actions: [
        { type: 'set_child_field', childDataformId: contacts._id, relationField: 'company', field: 'status', mode: 'formula', expression: 'IF(UPPER("customer") = "CUSTOMER", "customer", "lead")' },
        { type: 'create_record', dataformId: tickets._id, values: [{ field: 'subject', mode: 'formula', expression: 'CONCAT("Review ", {name}, " account")' }, { field: 'priority', value: 'high' }] },
      ],
    })).body.workflow;
    assert.equal(child.actions[0].relationField, 'company');
    await enable(child._id);
    await api('patch', OWNER, `/dataforms/${companies._id}/records/${co._id}`, { data: { industry: 'finance' } }).expect(200);
    await settle();
    const run = (await executions(child._id)).data[0];
    assert.equal(run.status, 'succeeded', JSON.stringify(run.actions));
    assert.match(run.actions[0].detail, /2 of 2 linked Contacts updated/);
    for (const c of [c1, c2]) assert.equal((await api('get', OWNER, `/dataforms/${contacts._id}/records/${c._id}`)).body.record.data.status, 'customer');
    assert.equal((await api('get', OWNER, `/dataforms/${contacts._id}/records/${loner._id}`)).body.record.data.status, 'lead', 'unlinked contacts are untouched');
    const ticket = (await api('post', OWNER, `/dataforms/${tickets._id}/records/query`, { q: 'Review Initech' })).body.data[0];
    assert.equal(ticket.data.subject, 'Review Initech account');
    assert.equal(ticket.data.priority, 'high');
    await remove(child._id);

    const clone = (await wf({ name: 'Duplicate deal', trigger: { type: 'manual' }, actions: [{ type: 'clone_record' }] })).body.workflow;
    await enable(clone._id);
    const src = (await deal({ title: 'Original', stage: 'proposal', value: 900 })).body.record;
    const ran = await api('post', MEMBER, `/workflows/${clone._id}/run`, { recordId: src._id });
    assert.equal(ran.body.execution.status, 'succeeded');
    const copies = (await api('post', OWNER, `/dataforms/${deals._id}/records/query`, { q: 'Original' })).body.data;
    assert.equal(copies.length, 2);
    assert.equal(copies.find((c) => c._id !== src._id).data.value, 900);
    await remove(clone._id);
  });
});

describe('manual workflows', () => {
  let manual; let rec;
  it('can be run by editors on a record, with the outcome returned', async () => {
    manual = (await wf({ name: 'Escalate', trigger: { type: 'manual', label: 'Escalate deal' }, conditions: { op: 'and', conditions: [eq('stage', 'negotiation')] }, actions: [{ type: 'comment', body: 'Escalated by {{user.name}}' }, { type: 'notify', recipients: { mode: 'users', users: [ids[OWNER]] }, title: 'Escalation: {{title}}' }] })).body.workflow;
    rec = (await deal({ title: 'Needs escalation', stage: 'negotiation' })).body.record;
    assert.equal((await api('post', MEMBER, `/workflows/${manual._id}/run`, { recordId: rec._id })).status, 409, 'paused workflows cannot be run');
    await enable(manual._id);
    const res = await api('post', MEMBER, `/workflows/${manual._id}/run`, { recordId: rec._id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.execution.status, 'succeeded');
    assert.equal(res.body.execution.event, 'manual');
    assert.equal(res.body.execution.actor, ids[MEMBER]);
    assert.equal((await Comment.findOne({ record: rec._id })).body, 'Escalated by Alex Morgan', 'actions run as the workflow creator');
    assert.equal((await notes(OWNER, 'workflow')).some((n) => n.title === 'Escalation: Needs escalation'), true);
  });

  it('skips records that do not meet the conditions and enforces access', async () => {
    const other = (await deal({ title: 'Not ready', stage: 'qualified' })).body.record;
    const res = await api('post', MEMBER, `/workflows/${manual._id}/run`, { recordId: other._id });
    assert.equal(res.body.execution.status, 'skipped');
    assert.equal(res.body.execution.conditionsMatched, false);
    assert.equal((await api('post', VIEWER, `/workflows/${manual._id}/run`, { recordId: rec._id })).status, 403);
    assert.equal((await api('post', GLOBEX, `/workflows/${manual._id}/run`, { recordId: rec._id })).status, 404);
    const contact = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Wrong form' } })).body.record;
    assert.equal((await api('post', MEMBER, `/workflows/${manual._id}/run`, { recordId: contact._id })).status, 404, 'the record must belong to the workflow\'s dataform');
    const auto = (await wf({ name: 'Automatic', trigger: { type: 'post_save' }, actions: [] })).body.workflow;
    assert.equal((await api('post', OWNER, `/workflows/${auto._id}/run`, { recordId: rec._id })).status, 400);
    await remove(auto._id);
  });

  it('shows editors only the manual workflows they may run', async () => {
    await wf({ name: 'Hidden draft', trigger: { type: 'manual' }, actions: [{ type: 'comment', body: 'x' }] });
    const forEditor = (await api('get', MEMBER, `/workflows?workspaceId=${ws._id}`)).body.data;
    assert.deepEqual(forEditor.map((w) => w.name), ['Escalate'], 'paused and automatic workflows are hidden');
    assert.equal(forEditor[0].actions, undefined, 'definitions are admin-only');
    assert.equal((await api('get', VIEWER, `/workflows?workspaceId=${ws._id}`)).status, 403);
    assert.ok((await api('get', OWNER, `/workflows?workspaceId=${ws._id}`)).body.data.length >= 2);
    assert.equal((await api('get', GLOBEX, `/workflows?workspaceId=${ws._id}`)).status, 404);
    await remove(manual._id);
  });
});

describe('communication actions', () => {
  it('posts to Slack and records it on the timeline, but fails clearly when Slack is not connected', async () => {
    const w = (await wf({ name: 'Slack ping', trigger: { type: 'manual' }, actions: [{ type: 'slack', text: ':tada: {{title}} is now {{stage}}' }] })).body.workflow;
    await enable(w._id);
    const rec = (await deal({ title: 'Slack deal', stage: 'won', value: 9000 })).body.record;
    const without = await api('post', OWNER, `/workflows/${w._id}/run`, { recordId: rec._id });
    assert.equal(without.body.execution.status, 'failed');
    assert.match(without.body.execution.error, /Slack is not connected/);

    await api('put', OWNER, '/integrations/slack', { secrets: { webhookUrl: 'https://hooks.slack.com/services/T1/B1/xyz' } }).expect(201);
    const executionAgain = (await api('post', OWNER, `/workflows/${w._id}/run`, { recordId: rec._id })).body.execution;
    assert.equal(executionAgain.status, 'succeeded');
    const post = calls.filter((c) => c.url === 'https://hooks.slack.com/services/T1/B1/xyz').at(-1);
    assert.equal(JSON.parse(post.init.body).text, ':tada: Slack deal is now Won');
    const timeline = (await api('get', OWNER, `/dataforms/${deals._id}/records/${rec._id}/interactions`)).body.data;
    assert.equal(timeline.find((i) => i.channel === 'slack').status, 'sent');
    await api('delete', OWNER, '/integrations/slack').expect(204);
    await remove(w._id);
  });

  it('emails and texts the recipient named by a field, and skips records without one', async () => {
    const sent = [];
    setMailer({ send: async (m) => { sent.push(m); return { messageId: '<id>' }; } });
    await api('put', OWNER, '/integrations/twilio', { secrets: { accountSid: `AC${'b'.repeat(32)}`, authToken: 'x'.repeat(20) }, settings: { smsFrom: '+14155550100' } }).expect(201);
    const w = (await wf({
      name: 'Welcome contact', dataformId: contacts._id, trigger: { type: 'manual' },
      actions: [
        { type: 'send_email', to: { mode: 'field', field: 'email' }, subject: 'Welcome, {{name}}', body: 'Hi {{name}}, glad to have you.' },
        { type: 'send_sms', to: { mode: 'field', field: 'phone' }, body: 'Welcome {{name}}!' },
      ],
    })).body.workflow;
    await enable(w._id);
    const full = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Full Contact', email: 'full@example.com', phone: '+14155550177' } })).body.record;
    const bare = (await api('post', OWNER, `/dataforms/${contacts._id}/records`, { data: { name: 'Bare Contact' } })).body.record;
    const ok = (await api('post', OWNER, `/workflows/${w._id}/run`, { recordId: full._id })).body.execution;
    assert.equal(ok.status, 'succeeded', JSON.stringify(ok));
    assert.equal(sent.at(-1).to, 'full@example.com');
    assert.equal(sent.at(-1).subject, 'Welcome, Full Contact');
    assert.ok(calls.filter((c) => c.url.endsWith('/Messages.json')).at(-1).init.body.toString().includes('Welcome+Full+Contact'));
    const none = (await api('post', OWNER, `/workflows/${w._id}/run`, { recordId: bare._id })).body.execution;
    assert.equal(none.status, 'succeeded');
    assert.deepEqual(none.actions.map((a) => a.status), ['skipped', 'skipped']);
    setMailer(null);
    const noMail = (await api('post', OWNER, `/workflows/${w._id}/run`, { recordId: full._id })).body.execution;
    assert.equal(noMail.status, 'failed');
    assert.match(noMail.error, /Email is not set up/);
    await api('delete', OWNER, '/integrations/twilio').expect(204);
    await remove(w._id);
  });
});

describe('scheduled workflows', () => {
  it('queues a run per record when due, exactly once, and honours pause', async () => {
    const total = (await api('post', OWNER, `/dataforms/${deals._id}/records/query`, { filter: { op: 'and', conditions: [eq('stage', 'lost')] }, limit: 1 })).body.total;
    assert.ok(total >= 2);
    const w = (await wf({
      name: 'Nightly: lost deals', trigger: { type: 'schedule', schedule: { frequency: 'daily', time: '02:00', timezone: 'America/New_York' } },
      conditions: { op: 'and', conditions: [eq('stage', 'lost')] }, actions: [{ type: 'comment', body: 'Reviewed on schedule' }],
    })).body.workflow;
    assert.equal(w.nextRunAt, undefined, 'paused: nothing scheduled');
    const on = (await enable(w._id)).body.workflow;
    assert.ok(new Date(on.nextRunAt) > new Date(), 'enabling schedules the next run in the future');
    assert.equal(await runDueWorkflows(), 0, 'nothing is due yet');

    await mongoose.connection.collection('workflows').updateOne({ _id: new mongoose.Types.ObjectId(w._id) }, { $set: { nextRunAt: new Date(Date.now() - 60_000) } });
    const [a, b] = await Promise.all([runDueWorkflows(), runDueWorkflows()]);
    assert.equal(a + b, 1, 'two instances racing queue the run once');
    await settle();
    const all = await executions(w._id, '?limit=100');
    assert.equal(all.total, (await api('post', OWNER, `/dataforms/${deals._id}/records/query`, { limit: 1 })).body.total, 'one run per record');
    const done = all.data.filter((r) => r.status === 'succeeded').length;
    const skipped = all.data.filter((r) => r.status === 'skipped').length;
    assert.equal(done, total, 'only lost deals were processed');
    assert.equal(done + skipped, all.total);
    assert.equal(await Comment.countDocuments({ body: 'Reviewed on schedule' }), total);
    assert.equal(await runDueWorkflows(), 0, 'the next run moved forward');

    const stored = await mongoose.connection.collection('workflows').findOne({ _id: new mongoose.Types.ObjectId(w._id) });
    assert.ok(stored.nextRunAt > new Date());
    await enable(w._id, false);
    await mongoose.connection.collection('workflows').updateOne({ _id: stored._id }, { $set: { nextRunAt: new Date(Date.now() - 1000) } });
    assert.equal(await runDueWorkflows(), 0, 'paused workflows never run');
    await remove(w._id);
  });
});

describe('formula tester and run history', () => {
  it('evaluates formulas against a real record or sample values and explains mistakes', async () => {
    const rec = (await deal({ title: 'Formula target', value: 400, stage: 'proposal' })).body.record;
    const run = (body) => api('post', MEMBER, '/workflows/test-formula', { dataformId: deals._id, ...body });
    const ok = await run({ expression: 'IF({value} > 300, UPPER({title}), "small")', recordId: rec._id });
    assert.deepEqual([ok.body.ok, ok.body.result, ok.body.type], [true, 'FORMULA TARGET', 'string']);
    assert.equal((await run({ expression: '{value} * 2', sample: { value: 21 } })).body.result, 42);
    assert.equal((await run({ expression: 'TODAY()', sample: {} })).body.type, 'date');
    assert.match((await run({ expression: '{value} +', sample: {} })).body.error, /ends unexpectedly/);
    assert.match((await run({ expression: '{nope} + 1', sample: {} })).body.error, /Unknown field \{nope\}/);
    assert.match((await run({ expression: '1 / 0', sample: {} })).body.error, /Division by zero/);
    assert.equal((await api('post', VIEWER, '/workflows/test-formula', { dataformId: deals._id, expression: '1' })).status, 403);
    assert.equal((await api('post', GLOBEX, '/workflows/test-formula', { dataformId: deals._id, expression: '1' })).status, 404);
  });

  it('paginates and filters history, and hides it from other tenants and non-admins', async () => {
    const w = (await wf({ name: 'History', trigger: { type: 'post_save', events: ['create'] }, actions: [{ type: 'comment', body: 'hi' }] })).body.workflow;
    await enable(w._id);
    for (let i = 0; i < 3; i++) await deal({ title: `History ${i}` });
    await settle();
    const page1 = await executions(w._id, '?limit=2');
    assert.equal(page1.data.length, 2);
    assert.equal(page1.total, 3);
    assert.equal((await executions(w._id, '?status=succeeded')).total, 3);
    assert.equal((await executions(w._id, '?status=failed')).total, 0);
    assert.equal(page1.data[0].snapshot, undefined, 'lists omit the record snapshot');
    const detail = await api('get', OWNER, `/workflows/executions/${page1.data[0]._id}`);
    assert.equal(detail.body.execution.snapshot.after.title.startsWith('History'), true);
    assert.equal((await api('get', MEMBER, `/workflows/${w._id}/executions`)).status, 403);
    assert.equal((await api('get', GLOBEX, `/workflows/${w._id}/executions`)).status, 404);
    assert.equal((await api('get', GLOBEX, `/workflows/executions/${page1.data[0]._id}`)).status, 404);
    await remove(w._id);
  });

  it('keeps definitions valid when edited and refuses to move a workflow between dataforms', async () => {
    const w = (await wf({ name: 'Editable', trigger: { type: 'post_save' }, actions: [{ type: 'comment', body: 'v1' }] })).body.workflow;
    const body = { name: 'Editable v2', dataformId: deals._id, trigger: { type: 'post_save' }, actions: [{ type: 'comment', body: 'v2' }] };
    const res = await api('put', OWNER, `/workflows/${w._id}`, body);
    assert.equal(res.status, 200);
    assert.equal(res.body.workflow.version, 2);
    assert.equal(res.body.workflow.actions[0].body, 'v2');
    assert.equal((await api('put', OWNER, `/workflows/${w._id}`, { ...body, actions: [{ type: 'set_field', field: 'ghost', value: 1 }] })).status, 400);
    assert.equal((await api('put', OWNER, `/workflows/${w._id}`, { ...body, dataformId: companies._id })).status, 400);
    assert.equal((await api('put', MEMBER, `/workflows/${w._id}`, body)).status, 403);
    await remove(w._id);
  });
});

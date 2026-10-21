import crypto from 'node:crypto';
import { postSlack } from '../../providers/slack.js';
import { request, assertPublicUrl } from '../../providers/http.js';
import { emitWorkspace } from '../../sockets/index.js';
import { Comment } from '../comments/comment.model.js';
import { followersOf } from '../comments/comment.service.js';
import { Dataform, FieldDefinition } from '../dataforms/dataform.model.js';
import { renderTemplate } from '../formulas/formula.js';
import { Interaction } from '../interactions/interaction.model.js';
import { sendMessage } from '../interactions/message.service.js';
import { getIntegration } from '../integrations/integration.service.js';
import { decrypt } from '../integrations/secrets.js';
import { notify } from '../notifications/notification.service.js';
import { RecordModel } from '../records/record.model.js';
import { Task, TaskActivity } from '../tasks/task.model.js';
import { usersWithAccess } from '../workspaces/access.js';
import { systemCreate, systemUpdate } from './systemWrite.js';
import { ActionError, computeValue } from './values.js';
import { Workflow } from './workflow.model.js';

// One runner per action type. A runner returns { status: 'ok' | 'skipped', detail } or throws; the engine records the outcome.
// env: { workflow, dataform, fields, byKey, workspace, recordId, event, snapshot, current, ctx, creator, source, execution, index }

const ok = (detail) => ({ status: 'ok', detail });
const skipped = (detail) => ({ status: 'skipped', detail });
const link = (env) => `/w/${env.dataform.workspace}/f/${env.dataform._id}?record=${env.recordId}`;
const render = (env, t) => renderTemplate(t, env.ctx.template);
const deleted = (env) => env.event === 'delete';

async function resolvePeople(env, spec) {
  if (spec.mode === 'creator') {
    const record = await RecordModel.findById(env.recordId).select('createdBy').lean();
    return record?.createdBy ? [String(record.createdBy)] : [];
  }
  if (spec.mode === 'followers') return followersOf(env.recordId);
  // Re-check access now: someone may have lost it since the workflow was written.
  return usersWithAccess(env.workspace, spec.users);
}

const RUNNERS = {
  async notify(a, env) {
    const recipients = await resolvePeople(env, a.recipients);
    if (!recipients.length) return skipped('No one to notify');
    await notify({ account: env.dataform.account, recipients, type: 'workflow', title: render(env, a.title), body: render(env, a.body), link: deleted(env) ? '' : link(env) });
    return ok(`Notified ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}`);
  },

  async create_task(a, env) {
    const requested = a.assignees.mode === 'creator' ? await resolvePeople(env, { mode: 'creator' }) : await resolvePeople(env, { mode: 'users', users: a.assignees.users });
    const assignees = a.assignees.mode === 'creator' ? await usersWithAccess(env.workspace, requested) : requested;
    const due = a.dueInDays === undefined ? undefined : new Date(Date.now() + a.dueInDays * 864e5);
    const task = await Task.create({
      account: env.dataform.account, workspace: env.dataform.workspace, createdBy: env.creator._id, title: render(env, a.title).slice(0, 200), description: render(env, a.description),
      assignees, priority: a.priority, due, ...(deleted(env) ? {} : { dataform: env.dataform._id, record: env.recordId }),
    });
    await TaskActivity.create({ account: task.account, task: task._id, user: env.creator._id, action: 'create' });
    await notify({ account: task.account, recipients: assignees, type: 'task_assigned', title: `You were assigned: ${task.title}`, body: due ? `Due ${due.toISOString().slice(0, 10)}` : '', link: `/tasks?task=${task._id}` });
    emitWorkspace(task.workspace, 'task.changed', { taskId: String(task._id) });
    return ok(`Created task "${task.title}"`);
  },

  async set_field(a, env) {
    if (deleted(env)) return skipped('The record was deleted');
    const target = env.byKey.get(a.field);
    if (!target) throw new ActionError(`The field ${a.field} no longer exists`);
    const value = computeValue(a, target, env.ctx.formula);
    const changed = await systemUpdate({ dataform: env.dataform, fields: env.fields, recordId: env.recordId, patch: { [a.field]: value }, actor: env.creator._id, workflow: env.workflow, source: env.source });
    return ok(changed ? `Set ${target.label}` : `${target.label} was already up to date`);
  },

  async set_child_field(a, env) {
    if (deleted(env)) return skipped('The record was deleted');
    const child = await Dataform.findOne({ _id: a.childDataformId, account: env.dataform.account, workspace: env.dataform.workspace });
    if (!child) throw new ActionError('The child dataform no longer exists');
    const childFields = await FieldDefinition.find({ dataform: child._id }).sort({ order: 1 }).lean();
    const target = childFields.find((f) => f.key === a.field);
    if (!target) throw new ActionError(`The field ${a.field} no longer exists in ${child.name}`);
    const value = computeValue(a, target, env.ctx.formula);
    const children = await RecordModel.find({ account: env.dataform.account, dataform: child._id, [`data.${a.relationField}`]: env.recordId }).select('_id').limit(500).lean();
    let updated = 0;
    for (const c of children) {
      if (await systemUpdate({ dataform: child, fields: childFields, recordId: c._id, patch: { [a.field]: value }, actor: env.creator._id, workflow: env.workflow, source: env.source })) updated++;
    }
    return ok(`${updated} of ${children.length} linked ${child.name} updated`);
  },

  async create_record(a, env) {
    const target = await Dataform.findOne({ _id: a.dataformId, account: env.dataform.account, workspace: env.dataform.workspace });
    if (!target) throw new ActionError('The target dataform no longer exists');
    const targetFields = await FieldDefinition.find({ dataform: target._id }).sort({ order: 1 }).lean();
    const data = {};
    for (const v of a.values) {
      const f = targetFields.find((x) => x.key === v.field);
      if (!f) throw new ActionError(`The field ${v.field} no longer exists in ${target.name}`);
      const value = computeValue(v, f, env.ctx.formula);
      if (value !== null) data[v.field] = value;
    }
    const record = await systemCreate({ dataform: target, fields: targetFields, data, actor: env.creator._id, workflow: env.workflow, source: env.source });
    return ok(`Created a ${target.name} record (${record._id})`);
  },

  async clone_record(a, env) {
    if (deleted(env)) return skipped('The record was deleted');
    const source = await RecordModel.findOne({ _id: env.recordId, account: env.dataform.account }).lean();
    if (!source) return skipped('The record no longer exists');
    const data = Object.fromEntries(Object.entries(source.data).filter(([k]) => { const f = env.byKey.get(k); return f && !f.unique; }));
    const copy = await systemCreate({ dataform: env.dataform, fields: env.fields, data, actor: env.creator._id, workflow: env.workflow, source: env.source });
    return ok(`Cloned the record (${copy._id})`);
  },

  async comment(a, env) {
    if (deleted(env)) return skipped('The record was deleted');
    const exists = await RecordModel.exists({ _id: env.recordId, account: env.dataform.account });
    if (!exists) return skipped('The record no longer exists');
    const body = render(env, a.body).slice(0, 5000);
    await Comment.create({ account: env.dataform.account, workspace: env.dataform.workspace, dataform: env.dataform._id, record: env.recordId, author: env.creator._id, body });
    await notify({ account: env.dataform.account, recipients: await followersOf(env.recordId), actor: env.creator._id, type: 'comment', title: `Automated comment on ${env.ctx.template.record.label}`, body, link: link(env) });
    emitWorkspace(env.dataform.workspace, 'comment.changed', { dataformId: String(env.dataform._id), recordId: String(env.recordId) });
    return ok('Added a comment');
  },

  async webhook(a, env) {
    const url = await assertPublicUrl(a.url); // re-checked at run time: DNS can change after the workflow was saved
    const doc = await Workflow.findById(env.workflow._id).select('+webhookSecret').lean();
    if (!doc?.webhookSecret) throw new ActionError('This workflow has no signing secret. Rotate it in the workflow settings');
    const data = env.current ?? {};
    const body = JSON.stringify({
      id: `${env.execution._id}:${env.index}`, event: env.event, occurredAt: new Date().toISOString(), workflow: { id: String(env.workflow._id), name: env.workflow.name },
      record: { id: String(env.recordId), dataformId: String(env.dataform._id), workspaceId: String(env.dataform.workspace), label: env.ctx.template.record.label, url: env.ctx.template.record.url, ...(a.includeRecord ? { data } : {}) },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', decrypt(doc.webhookSecret)).update(`${timestamp}.${body}`).digest('hex');
    const res = await request(url.toString(), {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'OrgCRM-Webhook/1', 'X-OrgCRM-Timestamp': timestamp, 'X-OrgCRM-Signature': `sha256=${signature}`, 'X-OrgCRM-Delivery': `${env.execution._id}:${env.index}` },
    });
    if (res.status >= 300 && res.status < 400) throw new Error(`The webhook redirected (${res.status}). Redirects are not followed`);
    if (!res.ok) throw new Error(`The webhook responded with ${res.status}`);
    return ok(`Delivered to ${url.host} (${res.status})`);
  },

  async slack(a, env) {
    const slack = await getIntegration(env.dataform.account, 'slack');
    if (!slack) throw new ActionError('Slack is not connected. An administrator can connect it under Settings > Integrations');
    const text = render(env, a.text);
    await postSlack(slack.secrets.webhookUrl, text);
    if (!deleted(env)) {
      await Interaction.create({ account: env.dataform.account, workspace: env.dataform.workspace, dataform: env.dataform._id, record: env.recordId, channel: 'slack', direction: 'outbound', status: 'sent', body: text.slice(0, 10000), workflow: env.workflow._id });
    }
    return ok('Posted to Slack');
  },
};

async function sendVia(channel, a, env) {
  const to = a.to.mode === 'fixed' ? a.to.address : env.current?.[a.to.field];
  if (!to) return skipped('The record has no value for the recipient field');
  await sendMessage({
    account: env.dataform.account, dataform: env.dataform, record: { _id: env.recordId }, channel, to, subject: a.subject ?? '', body: a.body, values: env.ctx.template,
    actor: env.creator, workflow: env.workflow, inline: true,
  });
  return ok(`${{ email: 'Emailed', sms: 'Sent an SMS to', whatsapp: 'Sent a WhatsApp message to' }[channel]} ${to}`);
}
RUNNERS.send_email = (a, env) => sendVia('email', a, env);
RUNNERS.send_sms = (a, env) => sendVia('sms', a, env);
RUNNERS.send_whatsapp = (a, env) => sendVia('whatsapp', a, env);

export const runAction = (action, env) => {
  const runner = RUNNERS[action.type];
  if (!runner) throw new ActionError(`Unsupported action: ${action.type}`);
  return runner(action, env);
};

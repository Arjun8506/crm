import { Router } from 'express';
import { z } from 'zod';
import { authenticate, humansOnly, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { Account } from '../accounts/account.model.js';
import { ApiKey } from '../apikeys/apikey.model.js';
import { audit } from '../audit/audit.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { createDataform } from '../dataforms/dataform.service.js';
import { TEMPLATES } from '../dataforms/templates.js';
import { Integration } from '../integrations/integration.model.js';
import { OutboundWebhook } from '../outbound/webhook.model.js';
import { RecordModel } from '../records/record.model.js';
import { Task } from '../tasks/task.model.js';
import { Membership } from '../users/membership.model.js';
import { Workflow } from '../workflows/workflow.model.js';
import { Workspace } from '../workspaces/workspace.model.js';
import { assertQuota, uniqueSlug } from '../workspaces/workspace.routes.js';

const router = Router();
router.use(authenticate);

// The checklist is computed from what really exists, so it can never claim something is done when it is not.
async function checklist(account, req) {
  const a = account._id;
  const [workspaces, dataforms, records, users, tasks, workflows, integrations, keys, hooks] = await Promise.all([
    Workspace.countDocuments({ account: a }), Dataform.countDocuments({ account: a }), RecordModel.countDocuments({ account: a }),
    Membership.countDocuments({ account: a, status: 'active' }), Task.countDocuments({ account: a }), Workflow.countDocuments({ account: a }),
    Integration.countDocuments({ account: a }), ApiKey.countDocuments({ account: a, revokedAt: null }), OutboundWebhook.countDocuments({ account: a }),
  ]);
  const first = (await Workspace.findOne({ account: a }).sort({ createdAt: 1 }).select('_id').lean())?._id;
  return [
    { id: 'profile', title: 'Tell us about your organisation', description: 'Industry and time zone make reminders and schedules land at the right time.', done: !!account.settings?.industry, link: '/settings/account' },
    { id: 'workspace', title: 'Create a workspace', description: 'A workspace groups the data for one team or project.', done: workspaces > 0, link: '/workspaces' },
    { id: 'dataform', title: 'Add a dataform', description: 'Dataforms hold your records: contacts, deals, tickets or anything else.', done: dataforms > 0, link: first ? `/w/${first}` : '/workspaces' },
    { id: 'records', title: 'Add your first records', description: 'Type them in, or import a CSV file from the dataform.', done: records > 0, link: first ? `/w/${first}` : '/workspaces' },
    { id: 'team', title: 'Bring in a teammate', description: 'See who is on your team and choose their roles.', done: users > 1, link: '/team' },
    { id: 'task', title: 'Create a task', description: 'Tasks and reminders keep follow-ups from slipping.', done: tasks > 0, link: '/tasks' },
    { id: 'automation', title: 'Automate something', description: 'A workflow can notify, create tasks or send messages for you.', done: workflows > 0, link: first ? `/w/${first}/workflows` : '/workspaces' },
    { id: 'connect', title: 'Connect a channel or another system', description: 'Email, SMS, Slack, an API key or a webhook.', done: integrations + keys + hooks > 0, link: '/settings/integrations' },
  ].map((s) => ({ ...s, canDo: req.auth.role !== 'viewer' }));
}

router.get('/', requirePermission('account:read'), async (req, res) => {
  const account = await Account.findById(req.auth.accountId).lean();
  const steps = await checklist(account, req);
  const admin = ['owner', 'admin'].includes(req.auth.role);
  res.json({
    steps, doneCount: steps.filter((s) => s.done).length, total: steps.length,
    completedAt: account.onboarding?.completedAt ?? null, dismissedAt: account.onboarding?.dismissedAt ?? null,
    // The setup wizard is offered once, to the people who can act on it, while the organisation is still empty.
    setupNeeded: admin && !account.onboarding?.completedAt,
    templates: TEMPLATES.map(({ id, name, description, category }) => ({ id, name, description, category })),
  });
});

router.post('/setup', humansOnly, requirePermission('account:update'), validate({
  body: z.object({
    industry: z.string().trim().max(80).optional(), timezone: z.string().max(60).optional(),
    workspaceName: z.string().trim().min(2).max(120), templates: z.array(z.string().max(40)).max(TEMPLATES.length).default([]),
  }),
}), async (req, res) => {
  const account = await Account.findById(req.auth.accountId);
  if (account.onboarding?.completedAt) throw conflict('Setup has already been completed');
  const unknown = req.body.templates.find((id) => !TEMPLATES.some((t) => t.id === id));
  if (unknown) throw badRequest(`Unknown template: ${unknown}`);
  if (req.body.timezone) { try { Intl.DateTimeFormat(undefined, { timeZone: req.body.timezone }); } catch { throw badRequest('Unknown time zone'); } }

  await assertQuota(account._id);
  const workspace = await Workspace.create({
    name: req.body.workspaceName, account: account._id, slug: await uniqueSlug(account._id, req.body.workspaceName),
    members: [{ user: req.auth.userId, role: 'admin' }], createdBy: req.auth.userId,
  });
  const dataforms = [];
  for (const id of [...new Set(req.body.templates)]) {
    const template = TEMPLATES.find((t) => t.id === id);
    dataforms.push(await createDataform({ accountId: account._id, userId: req.auth.userId, workspace, name: template.name, template }));
  }
  if (req.body.industry) account.set('settings.industry', req.body.industry);
  if (req.body.timezone) account.set('settings.timezone', req.body.timezone);
  account.set('onboarding.completedAt', new Date());
  await account.save();
  await audit(req, 'onboarding.completed', { type: 'account', id: account._id, summary: `${workspace.name} with ${dataforms.length} dataform(s)` });
  res.status(201).json({ workspace, dataforms });
});

// "Skip for now": finishes the wizard without creating anything.
router.post('/skip', humansOnly, requirePermission('account:update'), async (req, res) => {
  await Account.updateOne({ _id: req.auth.accountId, 'onboarding.completedAt': null }, { $set: { 'onboarding.completedAt': new Date() } });
  res.json({ ok: true });
});

router.post('/dismiss', humansOnly, requirePermission('account:update'), async (req, res) => {
  await Account.updateOne({ _id: req.auth.accountId }, { $set: { 'onboarding.dismissedAt': new Date() } });
  res.json({ ok: true });
});

router.post('/reopen', humansOnly, requirePermission('account:update'), async (req, res) => {
  await Account.updateOne({ _id: req.auth.accountId }, { $unset: { 'onboarding.dismissedAt': '' } });
  res.json({ ok: true });
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { emitWorkspace } from '../../sockets/index.js';
import { buildContext } from '../formulas/context.js';
import { renderTemplate } from '../formulas/formula.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { channelStatus } from '../integrations/integration.service.js';
import { loadFields } from '../records/record.service.js';
import { User } from '../users/user.model.js';
import { LEVEL, workspaceAccess } from '../workspaces/access.js';
import { recordLabel } from '../comments/comment.service.js';
import { Interaction, Template } from './interaction.model.js';
import { sendMessage } from './message.service.js';

// ---- record timeline: mounted at /dataforms/:id/records/:recordId ----
export const recordInteractionRouter = Router({ mergeParams: true });
recordInteractionRouter.use(authenticate);
const recordParams = z.object({ id: objectId, recordId: objectId });

recordInteractionRouter.get('/interactions', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  await recordLabel(dataform, req.params.recordId);
  const data = await Interaction.find({ account: dataform.account, record: req.params.recordId }).sort({ createdAt: -1 }).limit(200).populate('user', 'name').populate('workflow', 'name').lean();
  res.json({ data, channels: await channelStatus(dataform.account) });
});

async function contextFor(req, dataform, record) {
  const fields = await loadFields(dataform._id);
  const actor = await User.findById(req.auth.userId).select('name email').lean();
  const ctx = await buildContext({ account: dataform.account, dataform, fields, recordId: record._id, before: record.data, after: record.data, actor });
  return { ctx, actor, fields };
}

const messageBody = z.object({
  channel: z.enum(['email', 'sms', 'whatsapp']), to: z.string().trim().min(3).max(320),
  subject: z.string().trim().max(300).default(''), body: z.string().max(10000).default(''), templateId: objectId.optional(),
});

recordInteractionRouter.post('/messages', validate({ params: recordParams, body: messageBody }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'editor');
  const { record } = await recordLabel(dataform, req.params.recordId);
  let { subject, body } = req.body;
  if (req.body.templateId) {
    const t = await Template.findOne({ _id: req.body.templateId, account: dataform.account, workspace: dataform.workspace, channel: req.body.channel });
    if (!t) throw notFound('Template not found');
    subject = subject || t.subject;
    body = body || t.body;
  }
  const { ctx, actor } = await contextFor(req, dataform, record);
  const interaction = await sendMessage({
    account: dataform.account, dataform, record, channel: req.body.channel, to: req.body.to, subject, body, values: ctx.template,
    actor: { _id: req.auth.userId, name: actor?.name, email: actor?.email },
  });
  emitWorkspace(dataform.workspace, 'interaction.changed', { dataformId: String(dataform._id), recordId: String(record._id) });
  res.status(201).json({ interaction });
});

const logBody = z.object({
  channel: z.enum(['call', 'note']), direction: z.enum(['outbound', 'inbound']).default('outbound'), body: z.string().trim().min(1).max(10000),
  outcome: z.string().trim().max(60).optional(), durationSec: z.number().int().min(0).max(86400).optional(), to: z.string().trim().max(320).optional(),
});

// Manual log of a phone call or note. Nothing is sent: this only records what the user did.
recordInteractionRouter.post('/interactions', validate({ params: recordParams, body: logBody }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'editor');
  const { record } = await recordLabel(dataform, req.params.recordId);
  const interaction = await Interaction.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, record: record._id, ...req.body, status: 'logged', user: req.auth.userId,
    ...(req.body.channel === 'note' ? { direction: 'outbound', outcome: undefined, durationSec: undefined } : {}),
  });
  emitWorkspace(dataform.workspace, 'interaction.changed', { dataformId: String(dataform._id), recordId: String(record._id) });
  res.status(201).json({ interaction });
});

recordInteractionRouter.delete('/interactions/:interactionId', validate({ params: recordParams.extend({ interactionId: objectId }) }), async (req, res) => {
  const { dataform, access } = await loadDataform(req, 'editor');
  const i = await Interaction.findOne({ _id: req.params.interactionId, account: dataform.account, record: req.params.recordId });
  if (!i) throw notFound('Entry not found');
  if (!['call', 'note'].includes(i.channel)) throw forbidden('Sent and received messages are part of the record and cannot be deleted');
  if (String(i.user) !== req.auth.userId && access.level < LEVEL.admin) throw forbidden('Only the author or a workspace admin can delete this entry');
  await i.deleteOne();
  res.status(204).end();
});

// ---- templates and channel availability: mounted at /communications ----
const router = Router();
router.use(authenticate);
const idParams = z.object({ id: objectId });
const templateBody = z.object({ name: z.string().trim().min(1).max(80), channel: z.enum(['email', 'sms', 'whatsapp']), subject: z.string().trim().max(300).default(''), body: z.string().trim().min(1).max(10000) });

router.get('/channels', async (req, res) => res.json({ channels: await channelStatus(req.auth.accountId) }));

router.get('/templates', validate({ query: z.object({ workspaceId: objectId, channel: z.enum(['email', 'sms', 'whatsapp']).optional() }) }), async (req, res) => {
  const { workspace } = await workspaceAccess(req.auth, req.query.workspaceId);
  const data = await Template.find({ account: req.auth.accountId, workspace: workspace._id, ...(req.query.channel ? { channel: req.query.channel } : {}) }).sort({ name: 1 }).lean();
  res.json({ data });
});

router.post('/templates', validate({ query: z.object({ workspaceId: objectId }), body: templateBody }), async (req, res) => {
  const { workspace } = await workspaceAccess(req.auth, req.query.workspaceId, 'editor');
  const template = await Template.create({ ...req.body, account: req.auth.accountId, workspace: workspace._id, createdBy: req.auth.userId });
  res.status(201).json({ template });
});

async function loadTemplate(req, minLevel) {
  const template = await Template.findOne({ _id: req.params.id, account: req.auth.accountId });
  if (!template) throw notFound('Template not found');
  const access = await workspaceAccess(req.auth, template.workspace, minLevel);
  return { template, access };
}

router.patch('/templates/:id', validate({ params: idParams, body: templateBody }), async (req, res) => {
  const { template } = await loadTemplate(req, 'editor');
  Object.assign(template, req.body);
  await template.save();
  res.json({ template });
});

router.delete('/templates/:id', validate({ params: idParams }), async (req, res) => {
  const { template } = await loadTemplate(req, 'editor');
  await template.deleteOne();
  res.status(204).end();
});

// Preview: fill a template (or any text) with a record's values, exactly as the server will when sending.
router.post('/render', validate({ body: z.object({ dataformId: objectId, recordId: objectId, subject: z.string().max(300).default(''), body: z.string().max(10000).default('') }) }), async (req, res) => {
  req.params.id = req.body.dataformId;
  const { dataform } = await loadDataform(req);
  const { record } = await recordLabel(dataform, req.body.recordId);
  const { ctx } = await contextFor(req, dataform, record);
  res.json({ subject: renderTemplate(req.body.subject, ctx.template), body: renderTemplate(req.body.body, ctx.template) });
});

export default router;

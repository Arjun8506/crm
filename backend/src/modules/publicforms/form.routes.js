import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, humansOnly } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { audit } from '../audit/audit.js';
import { requireFeature } from '../billing/entitlements.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { importable } from '../imports/import.service.js';
import { loadFields } from '../records/record.service.js';
import { RecordModel } from '../records/record.model.js';
import { PublicShare, PublicForm, hashToken, newToken } from './public.models.js';
import { LEVEL, usersWithAccess } from '../workspaces/access.js';

const isEmpty = (v) => v === undefined || v === null || v === '';

// Fields a visitor may be asked for: ones people can type into. Links to other records are never offered publicly.
export const publicFieldsOf = (fields) => importable(fields).filter((f) => f.type !== 'relationship');

export const formUrl = (token) => `${env.APP_URL.replace(/\/$/, '')}/f/${token}`;
export const shareUrl = (token) => `${env.APP_URL.replace(/\/$/, '')}/s/${token}`;

// ---- public forms (admin) : mounted at /dataforms/:id/forms ----
export const formAdminRouter = Router({ mergeParams: true });
formAdminRouter.use(authenticate, humansOnly);
const idParams = z.object({ id: objectId });
const formParams = z.object({ id: objectId, formId: objectId });

const body = {
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000),
  successMessage: z.string().trim().min(1).max(500),
  fields: z.array(z.object({ key: z.string().max(60), label: z.string().trim().max(80).optional(), helpText: z.string().trim().max(200).optional(), required: z.boolean().optional() })).min(1, 'Choose at least one field').max(50),
  allowFiles: z.boolean(),
  opensAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)).nullable(),
  closesAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)).nullable(),
  maxSubmissions: z.number().int().min(1).max(1000000).nullable(),
  notifyUsers: z.array(objectId).max(10),
  enabled: z.boolean(),
};

async function check(req, dataform, access, input) {
  const all = await loadFields(dataform._id);
  if (input.fields) {
    const usable = new Map(publicFieldsOf(all).map((f) => [f.key, f]));
    const errors = [];
    const seen = new Set();
    for (const f of input.fields) {
      if (!usable.has(f.key)) errors.push({ path: 'fields', message: `"${f.key}" cannot be shown on a public form` });
      if (seen.has(f.key)) errors.push({ path: 'fields', message: `"${f.key}" is listed twice` });
      seen.add(f.key);
    }
    // A required field the visitor never sees can only be filled by its default.
    for (const f of all) {
      if (f.required && !seen.has(f.key) && isEmpty(f.defaultValue)) errors.push({ path: 'fields', message: `"${f.label}" is required, so it must be on the form (or have a default value)` });
    }
    if (errors.length) throw badRequest(errors[0].message, errors);
  }
  if (input.notifyUsers && (await usersWithAccess(access.workspace, input.notifyUsers)).length !== new Set(input.notifyUsers).size) throw badRequest('Everyone notified must be able to open this workspace');
  if (input.opensAt && input.closesAt && input.closesAt <= input.opensAt) throw badRequest('The form must close after it opens');
}

const present = (f) => ({ ...(f.toObject ? f.toObject() : f), url: formUrl(f.token) });

formAdminRouter.get('/', validate({ params: idParams }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  res.json({ data: (await PublicForm.find({ account: dataform.account, dataform: dataform._id }).sort({ createdAt: -1 }).lean()).map(present), usableFields: (await loadFields(dataform._id)).filter((f) => publicFieldsOf([f]).length).map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required })) });
});

formAdminRouter.post('/', validate({ params: idParams, body: z.object({ name: body.name, description: body.description.default(''), successMessage: body.successMessage.optional(), fields: body.fields, allowFiles: body.allowFiles.default(false), opensAt: body.opensAt.default(null), closesAt: body.closesAt.default(null), maxSubmissions: body.maxSubmissions.default(null), notifyUsers: body.notifyUsers.default([]) }) }), async (req, res) => {
  const { dataform, access } = await loadDataform(req, 'admin');
  await requireFeature(req.auth.accountId, 'publicPages', 'Public forms and shared links');
  await check(req, dataform, access, req.body);
  const form = await PublicForm.create({ ...req.body, account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, token: newToken(), createdBy: req.auth.userId });
  await audit(req, 'form.created', { type: 'form', id: form._id, summary: `${form.name} on ${dataform.name}` });
  res.status(201).json({ form: present(form) });
});

formAdminRouter.patch('/:formId', validate({ params: formParams, body: z.object(body).partial() }), async (req, res) => {
  const { dataform, access } = await loadDataform(req, 'admin');
  const form = await PublicForm.findOne({ _id: req.params.formId, account: dataform.account, dataform: dataform._id });
  if (!form) throw notFound('Form not found');
  await check(req, dataform, access, { ...req.body, opensAt: req.body.opensAt === undefined ? form.opensAt : req.body.opensAt, closesAt: req.body.closesAt === undefined ? form.closesAt : req.body.closesAt });
  form.set(req.body);
  await form.save();
  await audit(req, 'form.updated', { type: 'form', id: form._id, summary: `${form.name}${req.body.enabled === undefined ? '' : req.body.enabled ? ' (opened)' : ' (closed)'}` });
  res.json({ form: present(form) });
});

formAdminRouter.post('/:formId/regenerate-link', validate({ params: formParams }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  const form = await PublicForm.findOne({ _id: req.params.formId, account: dataform.account, dataform: dataform._id });
  if (!form) throw notFound('Form not found');
  form.token = newToken();
  await form.save();
  await audit(req, 'form.link_regenerated', { type: 'form', id: form._id, summary: form.name });
  res.json({ form: present(form) });
});

formAdminRouter.delete('/:formId', validate({ params: formParams }), async (req, res) => {
  const { dataform } = await loadDataform(req, 'admin');
  const form = await PublicForm.findOneAndDelete({ _id: req.params.formId, account: dataform.account, dataform: dataform._id });
  if (!form) throw notFound('Form not found');
  await audit(req, 'form.deleted', { type: 'form', id: form._id, summary: form.name });
  res.status(204).end();
});

// ---- record sharing : mounted at /dataforms/:id/records/:recordId/shares ----
export const shareAdminRouter = Router({ mergeParams: true });
shareAdminRouter.use(authenticate, humansOnly);
const shareParams = z.object({ id: objectId, recordId: objectId });

async function loadRecord(req, minLevel) {
  const { dataform, access } = await loadDataform(req, minLevel);
  const record = await RecordModel.findOne({ _id: req.params.recordId, account: dataform.account, dataform: dataform._id }).select('_id').lean();
  if (!record) throw notFound('Record not found');
  return { dataform, access, record };
}

shareAdminRouter.get('/', validate({ params: shareParams }), async (req, res) => {
  const { dataform, record } = await loadRecord(req, 'editor');
  const data = await PublicShare.find({ account: dataform.account, record: record._id }).sort({ createdAt: -1 }).limit(50).populate('createdBy', 'name').lean();
  res.json({ data: data.map(({ tokenHash: _h, ...s }) => ({ ...s, active: !s.revokedAt && s.expiresAt > new Date() })) });
});

shareAdminRouter.post('/', validate({ params: shareParams, body: z.object({ fields: z.array(z.string().max(60)).min(1, 'Choose at least one field to share').max(100), expiresInDays: z.number().int().min(1).max(90).default(7) }) }), async (req, res) => {
  const { dataform, record } = await loadRecord(req, 'editor');
  await requireFeature(req.auth.accountId, 'publicPages', 'Public forms and shared links');
  const usable = new Set((await loadFields(dataform._id)).filter((f) => f.visibility.list && f.type !== 'relationship').map((f) => f.key));
  const bad = req.body.fields.find((k) => !usable.has(k));
  if (bad) throw badRequest(`"${bad}" cannot be shared`);
  const token = newToken();
  const share = await PublicShare.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, record: record._id, tokenHash: hashToken(token), hint: token.slice(0, 4),
    fields: [...new Set(req.body.fields)], expiresAt: new Date(Date.now() + req.body.expiresInDays * 864e5), createdBy: req.auth.userId,
  });
  await audit(req, 'share.created', { type: 'record', id: record._id, summary: `${dataform.name}: shared ${share.fields.length} field(s) for ${req.body.expiresInDays} day(s)` });
  const { tokenHash: _h, ...safe } = share.toObject();
  res.status(201).json({ share: safe, token, url: shareUrl(token) });
});

shareAdminRouter.delete('/:shareId', validate({ params: z.object({ id: objectId, recordId: objectId, shareId: objectId }) }), async (req, res) => {
  const { dataform, access } = await loadRecord(req, 'editor');
  const share = await PublicShare.findOne({ _id: req.params.shareId, account: dataform.account, record: req.params.recordId });
  if (!share) throw notFound('Share not found');
  if (String(share.createdBy) !== req.auth.userId && access.level < LEVEL.admin) throw notFound('Share not found');
  share.revokedAt = new Date();
  await share.save();
  await audit(req, 'share.revoked', { type: 'record', id: share.record, summary: dataform.name });
  res.status(204).end();
});


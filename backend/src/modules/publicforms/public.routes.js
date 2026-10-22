import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { ApiError, badRequest, notFound } from '../../utils/errors.js';
import { emitWorkspace } from '../../sockets/index.js';
import { Account } from '../accounts/account.model.js';
import { saveAttachment } from '../attachments/attachment.service.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { notify } from '../notifications/notification.service.js';
import { RecordHistory, RecordModel } from '../records/record.model.js';
import { buildData, checkReferences, diff, label, loadFields } from '../records/record.service.js';
import { runPreSave, triggerPostSave } from '../workflows/trigger.js';
import { PublicForm, PublicShare, hashToken } from './public.models.js';

const MAX_FILES = 3;
const HONEYPOT = '_hp';
// Mutable so tests can shorten the waiting period; real traffic always uses the defaults.
export const timing = { minMs: 3000, maxMs: 2 * 3600e3 };

// ---- helpers ----
const sign = (formId, ts) => crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(`form:${formId}:${ts}`).digest('base64url');
const issue = (formId) => { const ts = Date.now(); return `${ts}.${sign(formId, ts)}`; };
function checkTiming(formId, token) {
  const [ts, mac] = String(token ?? '').split('.');
  const t = Number(ts);
  const good = Number.isFinite(t) && mac && mac.length === sign(formId, t).length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(formId, t)));
  if (!good) return false;
  const age = Date.now() - t;
  return age >= timing.minMs && age <= timing.maxMs;
}

const noStore = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
};
const limiter = (limit, windowMs = 10 * 60_000) => rateLimit({
  windowMs, limit: env.NODE_ENV === 'test' ? 10000 : limit, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again in a few minutes.' } }),
});

const router = Router();
router.use(noStore);

const closedReason = (form) => {
  const now = new Date();
  if (!form.enabled) return 'This form is closed.';
  if (form.opensAt && form.opensAt > now) return 'This form is not open yet.';
  if (form.closesAt && form.closesAt <= now) return 'This form is closed.';
  if (form.maxSubmissions && form.submissionCount >= form.maxSubmissions) return 'This form is no longer accepting responses.';
  return null;
};

async function loadForm(req, _res, next) {
  const token = String(req.params.token ?? '');
  const form = token.length >= 20 && token.length <= 80 ? await PublicForm.findOne({ token }) : null;
  if (!form) throw notFound('This form does not exist');
  const dataform = await Dataform.findOne({ _id: form.dataform, account: form.account });
  if (!dataform || dataform.status === 'archived') throw notFound('This form does not exist');
  req.pub = { form, dataform };
  next();
}

// ---- GET /public/forms/:token ----
router.get('/forms/:token', limiter(120), loadForm, async (req, res) => {
  const { form, dataform } = req.pub;
  const reason = closedReason(form);
  if (reason) throw new ApiError(410, 'FORM_CLOSED', reason);
  const byKey = new Map((await loadFields(dataform._id)).map((f) => [f.key, f]));
  const account = await Account.findById(form.account).lean();
  const fields = form.fields.filter((f) => byKey.has(f.key)).map((f) => {
    const d = byKey.get(f.key);
    return {
      key: f.key, label: f.label || d.label, helpText: f.helpText || d.description || '', required: !!(f.required || d.required), type: d.type, options: d.options.map((o) => ({ value: o.value, label: o.label })),
      min: d.min ?? undefined, max: d.max ?? undefined,
    };
  });
  res.json({ form: { name: form.name, description: form.description, fields, allowFiles: form.allowFiles, maxFiles: MAX_FILES, maxUploadMb: account?.entitlements?.maxUploadMb || 25 }, formToken: issue(form._id), honeypot: HONEYPOT, minSeconds: Math.ceil(timing.minMs / 1000) });
});

// ---- POST /public/forms/:token/submit ----
function receive(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  if (!req.pub.form.allowFiles) return next(badRequest('This form does not accept files'));
  const maxMb = req.pub.maxMb;
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: MAX_FILES, fields: 5, fieldSize: 100 * 1024 } }).array('files', MAX_FILES)(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'FILE_TOO_LARGE', `Files can be at most ${maxMb} MB`));
    if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') return next(badRequest(`You can attach at most ${MAX_FILES} files`));
    return next(err);
  });
}

router.post('/forms/:token/submit', limiter(20), loadForm, async (req, _res, next) => {
  req.pub.maxMb = (await Account.findById(req.pub.form.account).lean())?.entitlements?.maxUploadMb || 25;
  next();
}, receive, async (req, res) => {
  const { form, dataform } = req.pub;
  const reason = closedReason(form);
  if (reason) throw new ApiError(410, 'FORM_CLOSED', reason);

  const raw = req.body ?? {};
  const multipart = !!req.files;
  let input;
  try { input = multipart ? JSON.parse(raw.data ?? '{}') : raw.data; } catch { throw badRequest('The form data could not be read'); }
  const ok = () => res.json({ ok: true, message: form.successMessage });
  // Bots fill in every field, including the hidden one. They get the same answer as a real visitor but nothing is saved.
  if (raw[HONEYPOT]) return ok();
  if (!checkTiming(form._id, raw._t)) throw new ApiError(400, 'FORM_EXPIRED', 'This page has expired or was submitted too quickly. Please reload the form and try again.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('The form data could not be read');

  const exposed = new Map(form.fields.map((f) => [f.key, f]));
  const errors = [];
  for (const key of Object.keys(input)) if (!exposed.has(key)) errors.push({ path: `data.${key}`, message: 'Unknown field' });
  for (const [key, f] of exposed) {
    const v = input[key];
    if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length))) errors.push({ path: `data.${key}`, message: 'This field is required' });
  }
  if (errors.length) throw badRequest('Validation failed', errors);

  // Claim a response slot first, so concurrent submissions can never exceed the limit.
  const claimed = await PublicForm.findOneAndUpdate(
    { _id: form._id, enabled: true, $or: [{ maxSubmissions: null }, { $expr: { $lt: ['$submissionCount', '$maxSubmissions'] } }] },
    { $inc: { submissionCount: 1 } },
  );
  if (!claimed) throw new ApiError(410, 'FORM_CLOSED', 'This form is no longer accepting responses.');

  try {
    const fields = await loadFields(dataform._id);
    const auth = { accountId: String(form.account) };
    const built = buildData(fields, input, 'create', { system: true });
    const { data } = await runPreSave({ dataform, fields, event: 'create', before: null, after: built, auth });
    try {
      await checkReferences(auth, dataform, fields, data);
    } catch (err) {
      // Do not confirm to an anonymous visitor which values already exist in the system.
      if (err instanceof ApiError && err.details) throw badRequest('Validation failed', err.details.map((d) => ({ path: d.path, message: /already used/.test(d.message) ? 'This value is not available' : d.message })));
      throw err;
    }
    const record = await RecordModel.create({ account: form.account, workspace: form.workspace, dataform: dataform._id, data });
    await RecordHistory.create({ account: form.account, dataform: dataform._id, record: record._id, action: 'create', source: `form:${form.name}`.slice(0, 80), changes: diff({}, data) });
    for (const file of req.files ?? []) {
      try { await saveAttachment({ dataform, record, file }); } catch (err) { console.error('[public form] file rejected:', err.message); }
    }
    emitWorkspace(form.workspace, 'record.changed', { dataformId: String(dataform._id), recordId: String(record._id), action: 'create' });
    await triggerPostSave({ dataform, fields, event: 'create', before: null, after: record.data, recordId: record._id, version: record.createdAt.getTime() });
    await notify({
      account: form.account, recipients: form.notifyUsers, type: 'form_submission', title: `New response on “${form.name}”`, body: label(dataform, record.toObject()),
      link: `/w/${form.workspace}/f/${dataform._id}?record=${record._id}`,
    });
    return ok();
  } catch (err) {
    await PublicForm.updateOne({ _id: form._id }, { $inc: { submissionCount: -1 } });
    throw err;
  }
});

// ---- GET /public/shares/:token ----
// Every kind of failure (unknown, expired, revoked, record deleted) gives the same answer, so links cannot be probed.
router.get('/shares/:token', limiter(120), async (req, res) => {
  const token = String(req.params.token ?? '');
  const gone = () => notFound('This link is not available');
  if (token.length < 20 || token.length > 80) throw gone();
  const share = await PublicShare.findOne({ tokenHash: hashToken(token) });
  if (!share || share.revokedAt || share.expiresAt <= new Date()) throw gone();
  const [dataform, record, fields] = await Promise.all([
    Dataform.findOne({ _id: share.dataform, account: share.account }).lean(),
    RecordModel.findOne({ _id: share.record, account: share.account }).lean(),
    loadFields(share.dataform),
  ]);
  if (!dataform || !record) throw gone();
  await PublicShare.updateOne({ _id: share._id }, { $inc: { viewCount: 1 }, $set: { lastViewedAt: new Date() } });
  const shown = share.fields.map((k) => fields.find((f) => f.key === k)).filter((f) => f && f.visibility.list && f.type !== 'relationship');
  res.json({
    title: label(dataform, record), dataformName: dataform.name, expiresAt: share.expiresAt,
    fields: shown.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options.map((o) => ({ value: o.value, label: o.label })), value: record.data?.[f.key] ?? null })),
  });
});

export default router;

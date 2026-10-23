import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, humansOnly } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { AiError, aiConfigured, complete } from '../../providers/ai.js';
import { ApiError, notFound } from '../../utils/errors.js';
import { Account } from '../accounts/account.model.js';
import { analyze, analyzeSchema } from '../analytics/analyzer.js';
import { PlanLimitError, cheapestPlanWith, entitlementsOf } from '../billing/entitlements.js';
import { PLANS } from '../../config/plans.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { RecordModel } from '../records/record.model.js';
import { loadFields } from '../records/record.service.js';
import { validateWorkflow, workflowBody } from '../workflows/schema.js';
import { SYSTEM, WORKFLOW_GUIDE, activityContext, cap, discussionContext, extractJson, fieldCatalog, recordContext, wrap } from './ai.service.js';
import { AiUsage, monthKey } from './usage.model.js';

const router = Router();
router.use(authenticate, humansOnly);

// Per person, so one user cannot use up the provider's capacity for everyone.
const limiter = rateLimit({
  windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `ai:${req.auth?.userId}`,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'You are using AI assistance very quickly. Please wait a minute.' } }),
});

// ---- availability ----
async function availability(accountId) {
  const account = await Account.findById(accountId).lean();
  const limit = entitlementsOf(account).aiRequestsPerMonth;
  const used = (await AiUsage.findOne({ account: accountId, month: monthKey() }).lean())?.requests ?? 0;
  return { account, limit, used, configured: aiConfigured(), enabled: !!account.settings?.aiEnabled };
}

router.get('/status', async (req, res) => {
  const a = await availability(req.auth.accountId);
  const plan = cheapestPlanWith('aiRequestsPerMonth', (n) => n > 0);
  res.json({
    configured: a.configured, enabled: a.enabled, limit: a.limit, used: a.used, remaining: Math.max(0, a.limit - a.used),
    // One string the UI can show when the buttons are unavailable.
    available: a.configured && a.enabled && a.limit > a.used,
    reason: !a.configured ? 'not_configured' : !a.enabled ? 'disabled' : a.limit === 0 ? 'plan' : a.used >= a.limit ? 'quota' : null,
    includedFrom: plan ? PLANS[plan].name : null,
  });
});

// Everything that must be true before any data is prepared for a provider.
async function gate(req) {
  const a = await availability(req.auth.accountId);
  if (!a.configured) throw new ApiError(409, 'NOT_CONFIGURED', 'AI assistance is not set up on this server.');
  if (!a.enabled) throw new ApiError(403, 'AI_DISABLED', 'AI assistance is switched off for your organization. An administrator can turn it on under Account settings.');
  if (a.limit === 0) throw new PlanLimitError(`AI assistance is included from the ${PLANS[cheapestPlanWith('aiRequestsPerMonth', (n) => n > 0)]?.name ?? 'paid'} plan. Upgrade under Billing to use it.`, { limit: 'aiRequestsPerMonth' });
  return a;
}

// Counts one request against the monthly allowance. Atomic, so concurrent requests cannot overshoot it.
async function claim(accountId, limit) {
  const month = monthKey();
  await AiUsage.updateOne({ account: accountId, month }, { $setOnInsert: { requests: 0 } }, { upsert: true }).catch((e) => { if (e.code !== 11000) throw e; });
  const ok = await AiUsage.findOneAndUpdate({ account: accountId, month, requests: { $lt: limit } }, { $inc: { requests: 1 } });
  if (!ok) throw new PlanLimitError(`You have used all ${limit} AI requests included this month. They reset on the 1st, or you can upgrade under Billing.`, { limit: 'aiRequestsPerMonth' });
}
const refund = (accountId) => AiUsage.updateOne({ account: accountId, month: monthKey() }, { $inc: { requests: -1 } }).catch(() => {});

async function ask(req, a, opts) {
  await claim(req.auth.accountId, a.limit);
  try {
    return await complete({ system: SYSTEM, ...opts });
  } catch (err) {
    await refund(req.auth.accountId);
    if (err instanceof AiError) throw new ApiError(err.status, err.code, err.message);
    throw err;
  }
}

async function loadTarget(req, dataformId, recordId) {
  const { dataform } = await loadDataform({ ...req, params: { id: dataformId } });
  const record = await RecordModel.findOne({ _id: recordId, account: dataform.account, dataform: dataform._id }).lean();
  if (!record) throw notFound('Record not found');
  return { dataform, record, fields: await loadFields(dataform._id) };
}

const out = (result, extra = {}) => ({ model: result.model, truncated: result.truncated, ...extra });
const target = z.object({ dataformId: objectId, recordId: objectId });

// ---- rewrite text the person selected ----
const MODES = {
  professional: 'Rewrite the text so it sounds professional and polite, keeping the meaning.',
  friendly: 'Rewrite the text so it sounds warm and friendly, keeping the meaning.',
  concise: 'Rewrite the text to be shorter and clearer, keeping the meaning.',
  expand: 'Rewrite the text with a little more detail and clarity, without inventing facts.',
  fix: 'Fix spelling, grammar and punctuation only. Keep the wording and tone.',
};
router.post('/rewrite', limiter, validate({ body: z.object({ text: z.string().trim().min(1).max(4000), mode: z.enum(Object.keys(MODES)) }) }), async (req, res) => {
  const a = await gate(req);
  const r = await ask(req, a, { user: wrap(`${MODES[req.body.mode]} Reply with only the rewritten text.`, req.body.text), maxTokens: 1200 });
  res.json({ text: r.text, ...out(r, { shared: { selection: true } }) });
});

// ---- summaries and questions about one record ----
const SCOPES = { details: 'the field values', activity: 'the change history', discussion: 'the comments and communication' };
router.post('/summarize', limiter, validate({ body: target.extend({ scope: z.enum(['all', 'details', 'activity', 'discussion']).default('all') }) }), async (req, res) => {
  const { dataform, record, fields } = await loadTarget(req, req.body.dataformId, req.body.recordId);
  const a = await gate(req);
  const parts = []; const shared = {};
  const want = (s) => req.body.scope === 'all' || req.body.scope === s;
  if (want('details')) { const c = await recordContext({ auth: req.auth, dataform, record, fields }); parts.push(c.text); Object.assign(shared, { fields: c.shared, withheld: c.withheld, redactions: c.redactions }); }
  if (want('activity')) { const c = await activityContext({ record, fields }); if (c.text) parts.push(`Change history:\n${c.text}`); shared.historyEntries = c.entries; }
  if (want('discussion')) { const c = await discussionContext({ record }); if (c.text) parts.push(`Discussion and communication:\n${c.text}`); Object.assign(shared, { comments: c.comments, interactions: c.interactions, redactions: (shared.redactions ?? 0) + c.redactions }); }
  const what = req.body.scope === 'all' ? 'the record' : SCOPES[req.body.scope];
  const r = await ask(req, a, { user: wrap(`Summarize ${what} below for a colleague in 3 to 6 short sentences. Mention open questions or next steps only if the data shows them.`, cap(parts.join('\n\n'))), maxTokens: 600 });
  res.json({ text: r.text, ...out(r, { shared }) });
});

router.post('/ask', limiter, validate({ body: target.extend({ question: z.string().trim().min(3).max(500) }) }), async (req, res) => {
  const { dataform, record, fields } = await loadTarget(req, req.body.dataformId, req.body.recordId);
  const a = await gate(req);
  const c = await recordContext({ auth: req.auth, dataform, record, fields });
  const d = await discussionContext({ record });
  const r = await ask(req, a, { user: wrap(`Answer this question about the record using only the data below. Question: ${req.body.question}`, cap(`${c.text}\n\n${d.text ? `Discussion and communication:\n${d.text}` : ''}`)), maxTokens: 600 });
  res.json({ text: r.text, ...out(r, { shared: { fields: c.shared, withheld: c.withheld, comments: d.comments, interactions: d.interactions, redactions: c.redactions + d.redactions } }) });
});

// ---- email draft (never sent: the person reviews and sends it from the record) ----
router.post('/draft-email', limiter, validate({ body: target.extend({ intent: z.string().trim().min(3).max(500), tone: z.enum(['professional', 'friendly', 'brief']).default('professional') }) }), async (req, res) => {
  const { dataform, record, fields } = await loadTarget(req, req.body.dataformId, req.body.recordId);
  const a = await gate(req);
  const c = await recordContext({ auth: req.auth, dataform, record, fields });
  const r = await ask(req, a, {
    user: wrap(`Write a ${req.body.tone} email to the person or organisation this record is about. Purpose: ${req.body.intent}\nReply with only a JSON object: {"subject": string, "body": string}. The body is plain text with no placeholders for the recipient's address. Sign off without inventing a sender name.`, cap(c.text)),
    maxTokens: 900, temperature: 0.5,
  });
  const json = extractJson(r.text);
  if (!json || typeof json.subject !== 'string' || typeof json.body !== 'string') throw new ApiError(502, 'BAD_OUTPUT', 'The AI service did not return a usable draft. Please try again.');
  res.json({ subject: json.subject.slice(0, 300), body: json.body.slice(0, 10000), ...out(r, { shared: { fields: c.shared, withheld: c.withheld, redactions: c.redactions } }) });
});

// ---- explain a grouped analysis. Only the aggregated rows leave the server, never individual records ----
router.post('/explain-analysis', limiter, validate({ body: z.object({ dataformId: objectId, analysis: analyzeSchema, question: z.string().trim().max(300).optional() }) }), async (req, res) => {
  const { dataform } = await loadDataform({ ...req, params: { id: req.body.dataformId } });
  const fields = await loadFields(dataform._id);
  const a = await gate(req);
  const result = await analyze({ auth: req.auth, dataform, fields, params: { ...req.body.analysis, page: 1, limit: 50 } });
  const head = [...result.groups.map((g) => g.label), ...result.metrics.map((m) => `${m.op}${m.field ? ` of ${fields.find((f) => f.key === m.field)?.label ?? m.field}` : ''}`)].join(' | ');
  const show = (g, k) => {
    if (k === null) return '(empty)';
    const f = fields.find((x) => x.key === g.field);
    if (g.type === 'relationship') return result.refs?.[g.field]?.[k] ?? 'a linked record';
    return f?.options?.find((o) => o.value === k)?.label ?? k;
  };
  const lines = result.rows.map((row) => [...result.groups.map((g, i) => show(g, row.keys[i])), ...result.metrics.map((m) => row.metrics[m.key] ?? '')].join(' | '));
  const data = cap(`Grouped table of "${dataform.name}" (${result.total} groups${result.total > 50 ? ', first 50 shown' : ''}):\n${head}\n${lines.join('\n')}\nTotals: ${JSON.stringify(result.totals)}`);
  const r = await ask(req, a, { user: wrap(`Explain what this table shows in 3 to 5 short sentences: the biggest groups, notable gaps or trends, and one thing worth a closer look.${req.body.question ? ` The reader also asks: ${req.body.question}` : ''}`, data), maxTokens: 600 });
  res.json({ text: r.text, ...out(r, { shared: { rows: result.rows.length, aggregatedOnly: true } }) });
});

// ---- workflow and action drafts: UNTRUSTED. They are validated against the real dataform and never saved here ----
function problemsOf(err) {
  if (err instanceof ApiError && err.details?.length) return err.details.map((d) => ({ path: String(d.path), message: d.message }));
  if (err instanceof ApiError) return [{ path: '', message: err.message }];
  throw err;
}

async function checkDraft(req, dataform, access, fields, candidate) {
  const parsed = workflowBody.safeParse({ ...candidate, dataformId: String(dataform._id) });
  if (!parsed.success) return { valid: false, problems: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  try {
    await validateWorkflow(parsed.data, { account: dataform.account, workspace: access.workspace, dataform, fields });
    return { valid: true, problems: [], draft: parsed.data };
  } catch (err) { return { valid: false, problems: problemsOf(err) }; }
}

router.post('/suggest-workflow', limiter, validate({ body: z.object({ dataformId: objectId, description: z.string().trim().min(10).max(1000) }) }), async (req, res) => {
  const { dataform, access } = await loadDataform({ ...req, params: { id: req.body.dataformId } }, 'admin');
  const fields = await loadFields(dataform._id);
  const a = await gate(req);
  const r = await ask(req, a, {
    user: wrap(`Design one workflow for the dataform "${dataform.name}" that does this: ${req.body.description}\nUse only these fields:\n${fieldCatalog(fields)}\n\n${WORKFLOW_GUIDE}\nReply with only the JSON object for the workflow (without dataformId).`, ''),
    maxTokens: 1500, temperature: 0.2,
  });
  const candidate = extractJson(r.text);
  if (!candidate) throw new ApiError(502, 'BAD_OUTPUT', 'The AI service did not return a usable draft. Please try again or describe it differently.');
  const checked = await checkDraft(req, dataform, access, fields, candidate);
  res.json({ draft: checked.draft ?? candidate, valid: checked.valid, problems: checked.problems, ...out(r, { shared: { fields: fields.map((f) => f.label), noRecords: true } }) });
});

router.post('/suggest-action', limiter, validate({ body: z.object({ dataformId: objectId, description: z.string().trim().min(5).max(500), trigger: z.enum(['pre_save', 'post_save', 'manual']).default('manual') }) }), async (req, res) => {
  const { dataform, access } = await loadDataform({ ...req, params: { id: req.body.dataformId } }, 'admin');
  const fields = await loadFields(dataform._id);
  const a = await gate(req);
  const r = await ask(req, a, {
    user: wrap(`Configure ONE workflow action for the dataform "${dataform.name}" (workflow trigger: ${req.body.trigger}) that does this: ${req.body.description}\nUse only these fields:\n${fieldCatalog(fields)}\n\n${WORKFLOW_GUIDE}\nReply with only the JSON object of the single action.`, ''),
    maxTokens: 700, temperature: 0.2,
  });
  const action = extractJson(r.text);
  if (!action) throw new ApiError(502, 'BAD_OUTPUT', 'The AI service did not return a usable draft. Please try again or describe it differently.');
  const trigger = req.body.trigger === 'manual' ? { type: 'manual' } : { type: req.body.trigger, events: ['create', 'update'] };
  const checked = await checkDraft(req, dataform, access, fields, { name: 'Draft action', trigger, actions: [action] });
  res.json({ action, valid: checked.valid, problems: checked.problems, ...out(r, { shared: { fields: fields.map((f) => f.label), noRecords: true } }) });
});

export default router;

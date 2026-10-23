import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { PRODUCT_NEWS } from '../../config/news.js';
import { authenticate, humansOnly, requirePermission } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { getMailer } from '../../providers/email.js';
import { notFound } from '../../utils/errors.js';
import { Account } from '../accounts/account.model.js';
import { Membership } from '../users/membership.model.js';
import { User } from '../users/user.model.js';
import { Announcement, Feedback, NpsResponse } from './business.models.js';

const DAY = 864e5;
export const NPS_MIN_ACCOUNT_AGE_DAYS = 14;
export const NPS_REASK_DAYS = 90;
export const NPS_DISMISS_DAYS = 30;

const slow = (limit, message) => rateLimit({
  windowMs: 60 * 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : limit, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `fb:${req.auth?.userId}`,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message } }),
});

// ---------------- feedback and support ----------------
export const feedbackRouter = Router();
feedbackRouter.use(authenticate, humansOnly);

feedbackRouter.post('/', slow(10, 'You have sent a lot of feedback in the last hour. Please try again later.'), validate({
  body: z.object({ type: z.enum(['idea', 'bug', 'question', 'praise']), message: z.string().trim().min(5).max(2000), page: z.string().trim().max(200).optional() }),
}), async (req, res) => {
  const fb = await Feedback.create({ account: req.auth.accountId, user: req.auth.userId, ...req.body });
  // Also emailed when a support address AND a mail server are configured. The message is stored either way.
  const mailer = env.SUPPORT_EMAIL ? getMailer() : null;
  if (mailer) {
    try {
      const [user, account] = await Promise.all([User.findById(req.auth.userId).select('name email').lean(), Account.findById(req.auth.accountId).select('name').lean()]);
      await mailer.send({ to: env.SUPPORT_EMAIL, replyTo: user.email, subject: `[${req.body.type}] ${account.name}: ${req.body.message.slice(0, 60)}`, text: `${user.name} <${user.email}> (${account.name})${req.body.page ? `\nPage: ${req.body.page}` : ''}\n\n${req.body.message}` });
      fb.emailed = true;
      await fb.save();
    } catch (err) { console.error('[feedback] could not email support:', err.message); }
  }
  res.status(201).json({ feedback: fb, emailed: fb.emailed });
});

feedbackRouter.get('/mine', async (req, res) => {
  res.json({ data: await Feedback.find({ account: req.auth.accountId, user: req.auth.userId }).sort({ createdAt: -1 }).limit(50).lean() });
});

feedbackRouter.get('/', requirePermission('account:update'), validate({ query: z.object({ status: z.enum(['new', 'seen', 'planned', 'done', 'closed']).optional(), type: z.enum(['idea', 'bug', 'question', 'praise']).optional(), page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }) }), async (req, res) => {
  const q = { account: req.auth.accountId, ...(req.query.status ? { status: req.query.status } : {}), ...(req.query.type ? { type: req.query.type } : {}) };
  const { page, limit } = req.query;
  const [data, total] = await Promise.all([Feedback.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('user', 'name email').lean(), Feedback.countDocuments(q)]);
  res.json({ data, total, page, limit });
});

feedbackRouter.patch('/:id', requirePermission('account:update'), validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(['new', 'seen', 'planned', 'done', 'closed']) }) }), async (req, res) => {
  const fb = await Feedback.findOneAndUpdate({ _id: req.params.id, account: req.auth.accountId }, { $set: { status: req.body.status } }, { returnDocument: 'after' });
  if (!fb) throw notFound('Feedback not found');
  res.json({ feedback: fb });
});

// ---------------- news and announcements ----------------
export const announcementRouter = Router();
announcementRouter.use(authenticate);

announcementRouter.get('/', async (req, res) => {
  const [mine, user] = await Promise.all([
    Announcement.find({ account: req.auth.accountId, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).sort({ publishedAt: -1 }).limit(30).populate('createdBy', 'name').lean(),
    User.findById(req.auth.userId).select('seenAnnouncementsAt createdAt').lean(),
  ]);
  const seen = user.seenAnnouncementsAt ?? user.createdAt;
  const items = [
    ...mine.map((a) => ({ id: String(a._id), kind: 'organisation', title: a.title, body: a.body, date: a.publishedAt, author: a.createdBy?.name ?? null })),
    ...PRODUCT_NEWS.map((n) => ({ id: n.id, kind: 'product', title: n.title, body: n.body, date: new Date(`${n.date}T00:00:00Z`), author: null })),
  ].sort((a, b) => b.date - a.date).map((i) => ({ ...i, unread: i.date > seen }));
  res.json({ data: items, unread: items.filter((i) => i.unread).length });
});

announcementRouter.post('/seen', humansOnly, async (req, res) => {
  await User.updateOne({ _id: req.auth.userId }, { $set: { seenAnnouncementsAt: new Date() } });
  res.json({ ok: true });
});

announcementRouter.post('/', humansOnly, requirePermission('account:update'), validate({ body: z.object({ title: z.string().trim().min(2).max(120), body: z.string().trim().max(2000).default(''), expiresInDays: z.number().int().min(1).max(365).nullable().default(null) }) }), async (req, res) => {
  const a = await Announcement.create({ account: req.auth.accountId, title: req.body.title, body: req.body.body, createdBy: req.auth.userId, ...(req.body.expiresInDays ? { expiresAt: new Date(Date.now() + req.body.expiresInDays * DAY) } : {}) });
  res.status(201).json({ announcement: a });
});

announcementRouter.delete('/:id', humansOnly, requirePermission('account:update'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  if (!(await Announcement.findOneAndDelete({ _id: req.params.id, account: req.auth.accountId }))) throw notFound('Announcement not found');
  res.status(204).end();
});

// ---------------- NPS survey ----------------
export const npsRouter = Router();
npsRouter.use(authenticate, humansOnly);

export async function eligibility(auth, now = new Date()) {
  const membership = await Membership.findOne({ user: auth.userId, account: auth.accountId }).select('createdAt').lean();
  if (!membership || now - membership.createdAt < NPS_MIN_ACCOUNT_AGE_DAYS * DAY) return { eligible: false, reason: 'too_new' };
  const last = await NpsResponse.findOne({ account: auth.accountId, user: auth.userId }).sort({ createdAt: -1 }).lean();
  const answered = await NpsResponse.findOne({ account: auth.accountId, user: auth.userId, dismissed: false, createdAt: { $gt: new Date(now - NPS_REASK_DAYS * DAY) } }).lean();
  if (answered) return { eligible: false, reason: 'answered_recently' };
  if (last?.dismissed && now - last.createdAt < NPS_DISMISS_DAYS * DAY) return { eligible: false, reason: 'dismissed_recently' };
  return { eligible: true, reason: null };
}

npsRouter.get('/eligibility', async (req, res) => res.json(await eligibility(req.auth)));

npsRouter.post('/', validate({ body: z.object({ score: z.number().int().min(0).max(10), comment: z.string().trim().max(1000).optional() }) }), async (req, res) => {
  if (!(await eligibility(req.auth)).eligible) return res.status(409).json({ error: { code: 'NOT_ELIGIBLE', message: 'The survey is not available to you right now' } });
  await NpsResponse.create({ account: req.auth.accountId, user: req.auth.userId, score: req.body.score, comment: req.body.comment });
  return res.status(201).json({ ok: true });
});

npsRouter.post('/dismiss', async (req, res) => {
  await NpsResponse.create({ account: req.auth.accountId, user: req.auth.userId, dismissed: true });
  res.json({ ok: true });
});

npsRouter.get('/summary', requirePermission('account:update'), async (req, res) => {
  const since = new Date(Date.now() - 365 * DAY);
  const rows = await NpsResponse.find({ account: req.auth.accountId, dismissed: false, createdAt: { $gt: since } }).sort({ createdAt: -1 }).populate('user', 'name').lean();
  const n = rows.length;
  const promoters = rows.filter((r) => r.score >= 9).length;
  const detractors = rows.filter((r) => r.score <= 6).length;
  res.json({
    responses: n, promoters, passives: n - promoters - detractors, detractors,
    nps: n ? Math.round(((promoters - detractors) / n) * 100) : null,
    recent: rows.filter((r) => r.comment).slice(0, 10).map((r) => ({ score: r.score, comment: r.comment, at: r.createdAt, name: r.user?.name ?? null })),
  });
});

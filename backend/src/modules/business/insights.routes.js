import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, humansOnly, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Account } from '../accounts/account.model.js';
import { User } from '../users/user.model.js';
import { UsageEvent } from './business.models.js';

// Privacy-conscious product analytics. What is recorded: the NAME of a page or feature, when, and a one-way
// pseudonym per person. Never record content, URLs with ids, IP addresses or browser details.
// It is off for a person who turns it off, off for everyone if an admin turns it off, and off when the browser says Do Not Track.
export const EVENT_NAMES = [
  'page.workspaces', 'page.workspace', 'page.dataform', 'page.reports', 'page.dashboards', 'page.tasks', 'page.notifications', 'page.automation',
  'page.team', 'page.integrations', 'page.developers', 'page.billing', 'page.account', 'page.help', 'page.whatsnew',
  'feature.import', 'feature.export', 'feature.ai', 'feature.share', 'feature.public_form', 'feature.saved_view', 'feature.workflow', 'feature.kanban', 'feature.calendar', 'feature.map',
];

export const actorOf = (accountId, userId) => crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(`usage:${accountId}:${userId}`).digest('hex').slice(0, 24);

const limiter = rateLimit({
  windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `ev:${req.auth?.userId}`, handler: (_req, res) => res.status(204).end(),
});

const router = Router();
router.use(authenticate, humansOnly);

const doNotTrack = (req) => req.headers.dnt === '1' || req.headers['sec-gpc'] === '1';

router.get('/privacy', async (req, res) => {
  const [account, user] = await Promise.all([Account.findById(req.auth.accountId).select('settings.analytics').lean(), User.findById(req.auth.userId).select('preferences.analytics').lean()]);
  res.json({
    organisation: account.settings?.analytics !== false, person: user.preferences?.analytics !== false, doNotTrack: doNotTrack(req),
    recorded: 'The name of the page or feature you used and when, linked to a one-way code instead of your name or email. Never record contents, addresses or device details.',
  });
});

// Always answers 204, so the page cannot tell (and does not care) whether the event was kept.
router.post('/', limiter, validate({ body: z.object({ name: z.enum(EVENT_NAMES) }) }), async (req, res) => {
  if (doNotTrack(req)) return res.status(204).end();
  const [account, user] = await Promise.all([Account.findById(req.auth.accountId).select('settings.analytics').lean(), User.findById(req.auth.userId).select('preferences.analytics').lean()]);
  if (account?.settings?.analytics === false || user?.preferences?.analytics === false) return res.status(204).end();
  await UsageEvent.create({ account: req.auth.accountId, actor: actorOf(req.auth.accountId, req.auth.userId), name: req.body.name });
  return res.status(204).end();
});

// "Delete what you have recorded about me."
router.delete('/me', async (req, res) => {
  const r = await UsageEvent.deleteMany({ account: req.auth.accountId, actor: actorOf(req.auth.accountId, req.auth.userId) });
  res.json({ deleted: r.deletedCount });
});

// For admins: which pages and features are used, by how many different people. No names.
router.get('/summary', requirePermission('account:update'), validate({ query: z.object({ days: z.coerce.number().int().min(1).max(180).default(30) }) }), async (req, res) => {
  const since = new Date(Date.now() - req.query.days * 864e5);
  const match = { account: new mongoose.Types.ObjectId(req.auth.accountId), at: { $gte: since } };
  const [byName, people] = await Promise.all([
    UsageEvent.aggregate([{ $match: match }, { $group: { _id: '$name', events: { $sum: 1 }, actors: { $addToSet: '$actor' } } }, { $project: { events: 1, people: { $size: '$actors' } } }, { $sort: { events: -1 } }]),
    UsageEvent.distinct('actor', match),
  ]);
  res.json({ days: req.query.days, activePeople: people.length, features: byName.map((r) => ({ name: r._id, events: r.events, people: r.people })), enabled: (await Account.findById(req.auth.accountId).select('settings.analytics').lean()).settings?.analytics !== false });
});

export default router;

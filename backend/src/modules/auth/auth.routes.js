import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { isProd, env } from '../../config/env.js';
import { permissionsFor } from '../../config/permissions.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { badRequest, conflict, unauthorized } from '../../utils/errors.js';
import { slugify } from '../../utils/slug.js';
import { Account } from '../accounts/account.model.js';
import { User } from '../users/user.model.js';
import { Membership } from '../users/membership.model.js';
import {
  consumeSession, createSession, hashPassword, revokeAllSessions, revokeSession, signAccessToken, verifyPassword,
} from './auth.service.js';

const router = Router();
const COOKIE = 'rt';
const cookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'strict' : 'lax',
  path: '/api/v1/auth',
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

// Refresh/logout cookies are only honoured with a custom header, which cross-site forms cannot send (CSRF defence).
const requireCsrfHeader = (req, _res, next) => {
  if (req.get('x-requested-with') !== 'orgcrm') throw badRequest('Missing X-Requested-With header');
  next();
};

const password = z.string().min(8, 'At least 8 characters').max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Must contain a letter and a number');

async function issue(res, req, user, accountId) {
  const membership = await Membership.findOne({ user: user._id, account: accountId, status: 'active' }).lean();
  if (!membership) throw unauthorized('No active membership');
  const account = await Account.findById(accountId).lean();
  const session = await createSession(user._id, accountId, req.get('user-agent'));
  res.cookie(COOKIE, session.token, { ...cookieOpts, expires: session.expiresAt });
  return {
    accessToken: signAccessToken(user._id, accountId),
    user: user.toJSON ? user.toJSON() : user,
    account,
    role: membership.role,
    permissions: permissionsFor(membership.role),
  };
}

router.post(
  '/signup',
  authLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(120),
      email: z.email().toLowerCase(),
      password,
      accountName: z.string().trim().min(2).max(120),
    }),
  }),
  async (req, res) => {
    const { name, email, password: pw, accountName } = req.body;
    if (await User.exists({ email })) throw conflict('An account with this email already exists');

    let slug = slugify(accountName);
    if (await Account.exists({ slug })) slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;

    const account = await Account.create({ name: accountName, slug });
    try {
      const user = await User.create({ name, email, passwordHash: await hashPassword(pw), defaultAccount: account._id });
      await Membership.create({ account: account._id, user: user._id, role: 'owner' });
      res.status(201).json(await issue(res, req, user, account._id));
    } catch (err) {
      await Account.deleteOne({ _id: account._id });
      throw err;
    }
  },
);

router.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ email: z.email().toLowerCase(), password: z.string().min(1).max(128) }) }),
  async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select('+passwordHash');
    // Always run a hash comparison so response time does not reveal whether the email exists.
    const ok = await verifyPassword(req.body.password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    if (!user || !ok) throw unauthorized('Invalid email or password');

    const membership = await Membership.findOne({ user: user._id, account: user.defaultAccount, status: 'active' })
      || await Membership.findOne({ user: user._id, status: 'active' });
    if (!membership) throw unauthorized('No active account membership');

    user.lastLoginAt = new Date();
    await user.save();
    res.json(await issue(res, req, user, membership.account));
  },
);

router.post('/refresh', requireCsrfHeader, async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw unauthorized('No session');
  const session = await consumeSession(token);
  if (!session) {
    res.clearCookie(COOKIE, cookieOpts);
    throw unauthorized('Session expired');
  }
  const user = await User.findById(session.user);
  if (!user) throw unauthorized('Session expired');
  res.json(await issue(res, req, user, session.account));
});

router.post('/logout', requireCsrfHeader, async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) await revokeSession(token);
  res.clearCookie(COOKIE, cookieOpts);
  res.status(204).end();
});

router.post('/logout-all', authenticate, async (req, res) => {
  await revokeAllSessions(req.auth.userId);
  res.clearCookie(COOKIE, cookieOpts);
  res.status(204).end();
});

router.get('/me', authenticate, async (req, res) => {
  const [user, account] = await Promise.all([User.findById(req.auth.userId), Account.findById(req.auth.accountId).lean()]);
  res.json({ user, account, role: req.auth.role, permissions: permissionsFor(req.auth.role) });
});

export default router;

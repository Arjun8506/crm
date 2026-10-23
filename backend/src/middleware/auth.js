import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../modules/auth/auth.service.js';
import { Account } from '../modules/accounts/account.model.js';
import { ApiKey, API_KEY_PREFIX, hashKey } from '../modules/apikeys/apikey.model.js';
import { keyAllows } from '../modules/apikeys/policy.js';
import { PlanLimitError, entitlementsOf } from '../modules/billing/entitlements.js';
import { Membership } from '../modules/users/membership.model.js';
import { can } from '../config/permissions.js';
import { ApiError, forbidden, unauthorized } from '../utils/errors.js';

// Each API key has its own request budget, separate from the per-IP limit.
const keyLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.NODE_ENV === 'test' ? 100_000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `key:${req.auth.apiKey.id}`,
  handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'This API key has made too many requests. Try again in a minute')),
});
const runLimiter = (req, res) => new Promise((resolve, reject) => keyLimiter(req, res, (err) => (err ? reject(err) : resolve())));

async function authenticateApiKey(token, req, res) {
  const key = await ApiKey.findOne({ hash: hashKey(token) }).lean();
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) throw unauthorized('Invalid or expired API key');
  const account = await Account.findById(key.account).select('status plan entitlementOverrides').lean();
  if (!account || account.status !== 'active') throw unauthorized('Invalid or expired API key');
  if (!entitlementsOf(account).apiAccess) throw new PlanLimitError('API access is not included in the current plan', { limit: 'apiAccess' });

  const path = req.originalUrl.split('?')[0].replace(/^\/api\/v1/, '');
  if (!keyAllows(key.scope, req.method, path)) {
    throw new ApiError(403, 'API_KEY_FORBIDDEN', key.scope === 'read' && keyAllows('write', req.method, path)
      ? 'This API key is read-only'
      : 'API keys cannot use this endpoint');
  }
  // A key is a service identity with a deliberately low role, so it can never reach admin-only features.
  req.auth = {
    userId: String(key._id), accountId: String(key.account), role: key.scope === 'write' ? 'member' : 'viewer',
    apiKey: { id: String(key._id), name: key.name, workspaces: key.workspaces.map(String) },
  };
  await runLimiter(req, res);
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
}

// Verifies a user's JWT (re-reading the membership so role/status are never taken from the token), or an API key.
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = req.get('x-api-key') ?? bearer;
  if (token?.startsWith(API_KEY_PREFIX)) {
    await authenticateApiKey(token, req, res);
    return next();
  }
  if (!bearer) throw unauthorized();
  const payload = verifyAccessToken(bearer);
  const membership = await Membership.findOne({ user: payload.sub, account: payload.acc, status: 'active' }).lean();
  if (!membership) throw unauthorized('Account access revoked');
  req.auth = {
    userId: payload.sub,
    accountId: String(membership.account),
    role: membership.role,
    membershipId: String(membership._id),
  };
  return next();
}

export const requirePermission = (permission) => (req, _res, next) => {
  if (!can(req.auth.role, permission)) throw forbidden();
  next();
};

// Endpoints that manage the account itself are never available to API keys, even if a route forgot its own permission check.
export const humansOnly = (req, _res, next) => {
  if (req.auth.apiKey) throw new ApiError(403, 'API_KEY_FORBIDDEN', 'API keys cannot use this endpoint');
  next();
};

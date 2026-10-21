import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { Session } from './session.model.js';
import { unauthorized } from '../../utils/errors.js';

export const hashPassword = (pw) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const signAccessToken = (userId, accountId) =>
  jwt.sign({ acc: String(accountId) }, env.JWT_ACCESS_SECRET, {
    subject: String(userId),
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
    algorithm: 'HS256',
  });

export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Invalid or expired token');
  }
};

export async function createSession(userId, accountId, userAgent) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 864e5);
  await Session.create({ user: userId, account: accountId, tokenHash: sha256(token), userAgent: userAgent?.slice(0, 300), expiresAt });
  return { token, expiresAt };
}

// Rotating refresh: the presented token is consumed (deleted) atomically, so a replay finds nothing.
export const consumeSession = (token) =>
  Session.findOneAndDelete({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
export const revokeSession = (token) => Session.deleteOne({ tokenHash: sha256(token) });
export const revokeAllSessions = (userId) => Session.deleteMany({ user: userId });

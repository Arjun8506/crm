import { verifyAccessToken } from '../modules/auth/auth.service.js';
import { Membership } from '../modules/users/membership.model.js';
import { can } from '../config/permissions.js';
import { forbidden, unauthorized } from '../utils/errors.js';

// Verifies the JWT, then reloads the membership so role and status are never taken from the token.
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw unauthorized();
  const payload = verifyAccessToken(header.slice(7));
  const membership = await Membership.findOne({ user: payload.sub, account: payload.acc, status: 'active' }).lean();
  if (!membership) throw unauthorized('Account access revoked');
  req.auth = {
    userId: payload.sub,
    accountId: String(membership.account),
    role: membership.role,
    membershipId: String(membership._id),
  };
  next();
}

export const requirePermission = (permission) => (req, _res, next) => {
  if (!can(req.auth.role, permission)) throw forbidden();
  next();
};

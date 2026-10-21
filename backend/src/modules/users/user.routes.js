import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { Membership } from './membership.model.js';
import { User } from './user.model.js';

const router = Router();
router.use(authenticate);

// Current user's own profile and preferences.
router.patch(
  '/me',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      preferences: z.object({ theme: z.enum(['light', 'dark', 'system']).optional() }).optional(),
    }),
  }),
  async (req, res) => {
    const $set = {};
    if (req.body.name) $set.name = req.body.name;
    if (req.body.preferences?.theme) $set['preferences.theme'] = req.body.preferences.theme;
    const user = await User.findByIdAndUpdate(req.auth.userId, { $set }, { new: true });
    res.json({ user });
  },
);

// Members of the caller's account only (tenant scoped).
router.get('/', requirePermission('user:read'), async (req, res) => {
  const memberships = await Membership.find({ account: req.auth.accountId })
    .populate('user', 'name email emailVerified lastLoginAt')
    .sort({ createdAt: 1 })
    .lean();
  res.json({
    data: memberships.filter((m) => m.user).map((m) => ({
      id: m._id, role: m.role, status: m.status, user: m.user,
    })),
  });
});

const idParams = z.object({ id: objectId });

router.patch(
  '/:id',
  requirePermission('user:manage'),
  validate({ params: idParams, body: z.object({ role: z.enum(['admin', 'member', 'viewer']).optional(), status: z.enum(['active', 'disabled']).optional() }) }),
  async (req, res) => {
    const target = await Membership.findOne({ _id: req.params.id, account: req.auth.accountId });
    if (!target) throw notFound();
    if (target.role === 'owner') throw forbidden('The account owner cannot be modified');
    if (String(target._id) === req.auth.membershipId) throw forbidden('You cannot change your own membership');
    Object.assign(target, req.body);
    await target.save();
    res.json({ id: target._id, role: target.role, status: target.status });
  },
);

export default router;

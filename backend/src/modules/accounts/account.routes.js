import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { notFound } from '../../utils/errors.js';
import { audit } from '../audit/audit.js';
import { entitlementsOf } from '../billing/entitlements.js';
import { Account } from './account.model.js';
import { Workspace } from '../workspaces/workspace.model.js';
import { Membership } from '../users/membership.model.js';

const router = Router();
router.use(authenticate);

router.get('/current', requirePermission('account:read'), async (req, res) => {
  const account = await Account.findById(req.auth.accountId).lean();
  if (!account) throw notFound();
  const [workspaces, users] = await Promise.all([
    Workspace.countDocuments({ account: account._id }),
    Membership.countDocuments({ account: account._id, status: 'active' }),
  ]);
  res.json({ account: { ...account, entitlements: entitlementsOf(account) }, usage: { workspaces, users } });
});

router.patch(
  '/current',
  requirePermission('account:update'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120).optional(),
      settings: z.object({
        timezone: z.string().max(60).optional(),
        industry: z.string().trim().max(80).optional(),
        aiEnabled: z.boolean().optional(),
        analytics: z.boolean().optional(),
      }).optional(),
    }),
  }),
  async (req, res) => {
    const { name, settings } = req.body;
    const $set = {};
    if (name) $set.name = name;
    for (const [k, v] of Object.entries(settings || {})) $set[`settings.${k}`] = v;
    const account = await Account.findByIdAndUpdate(req.auth.accountId, { $set }, { returnDocument: 'after', runValidators: true }).lean();
    await audit(req, 'account.updated', { type: 'account', id: req.auth.accountId, summary: Object.keys($set).join(', ') });
    res.json({ account });
  },
);

export default router;

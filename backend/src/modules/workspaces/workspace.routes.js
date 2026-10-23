import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { can } from '../../config/permissions.js';
import { PLANS } from '../../config/plans.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { slugify } from '../../utils/slug.js';
import { Account } from '../accounts/account.model.js';
import { PlanLimitError, entitlementsOf } from '../billing/entitlements.js';
import { purgeWorkspace } from '../records/cleanup.js';
import { Workspace } from './workspace.model.js';

const router = Router();
router.use(authenticate);

const isAccountAdmin = (auth) => can(auth.role, 'workspace:admin');

// Visibility filter: admins see everything in their account; others see account-visible
// workspaces plus private ones they belong to.
const visibleFilter = (auth) => ({
  account: auth.accountId,
  ...(auth.apiKey?.workspaces?.length ? { _id: { $in: auth.apiKey.workspaces } } : {}),
  ...(isAccountAdmin(auth)
    ? {}
    : { $or: [{ visibility: 'account' }, { 'members.user': auth.userId }] }),
});

async function loadWorkspace(req, { write = false } = {}) {
  const ws = await Workspace.findOne({ _id: req.params.id, ...visibleFilter(req.auth) });
  if (!ws) throw notFound('Workspace not found');
  if (write) {
    const mine = ws.members.find((m) => String(m.user) === req.auth.userId);
    if (!isAccountAdmin(req.auth) && mine?.role !== 'admin') throw forbidden();
  }
  return ws;
}

export async function uniqueSlug(accountId, base) {
  let slug = slugify(base);
  let n = 1;
  while (await Workspace.exists({ account: accountId, slug })) slug = `${slugify(base)}-${++n}`;
  return slug;
}

export async function assertQuota(accountId) {
  const [account, count] = await Promise.all([Account.findById(accountId).lean(), Workspace.countDocuments({ account: accountId })]);
  const limit = entitlementsOf(account).maxWorkspaces;
  if (count >= limit) throw new PlanLimitError(`Your ${PLANS[account.plan]?.name ?? account.plan} plan allows up to ${limit} workspaces. Upgrade under Billing for more.`, { limit: 'maxWorkspaces' });
}

const fields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  visibility: z.enum(['account', 'private']),
};
const idParams = z.object({ id: objectId });

router.get('/', requirePermission('workspace:read'), async (req, res) => {
  const data = await Workspace.find(visibleFilter(req.auth)).sort({ name: 1 }).lean();
  res.json({ data });
});

router.get('/:id', requirePermission('workspace:read'), validate({ params: idParams }), async (req, res) => {
  res.json({ workspace: await loadWorkspace(req) });
});

router.post(
  '/',
  requirePermission('workspace:create'),
  validate({ body: z.object({ name: fields.name, description: fields.description.optional(), color: fields.color.optional(), visibility: fields.visibility.optional() }) }),
  async (req, res) => {
    await assertQuota(req.auth.accountId);
    const workspace = await Workspace.create({
      ...req.body,
      account: req.auth.accountId,
      slug: await uniqueSlug(req.auth.accountId, req.body.name),
      members: [{ user: req.auth.userId, role: 'admin' }],
      createdBy: req.auth.userId,
    });
    res.status(201).json({ workspace });
  },
);

router.patch(
  '/:id',
  requirePermission('workspace:read'),
  validate({ params: idParams, body: z.object({ name: fields.name.optional(), description: fields.description.optional(), color: fields.color.optional(), visibility: fields.visibility.optional() }) }),
  async (req, res) => {
    const ws = await loadWorkspace(req, { write: true });
    Object.assign(ws, req.body);
    await ws.save();
    res.json({ workspace: ws });
  },
);

router.post('/:id/clone', requirePermission('workspace:create'), validate({ params: idParams }), async (req, res) => {
  const source = await loadWorkspace(req);
  await assertQuota(req.auth.accountId);
  const name = `${source.name} (copy)`;
  // Phase 1 clones workspace configuration; dataforms/records will be cloned once they exist.
  const workspace = await Workspace.create({
    account: req.auth.accountId,
    name,
    slug: await uniqueSlug(req.auth.accountId, name),
    description: source.description,
    color: source.color,
    visibility: source.visibility,
    members: [{ user: req.auth.userId, role: 'admin' }],
    createdBy: req.auth.userId,
  });
  res.status(201).json({ workspace });
});

router.delete('/:id', requirePermission('workspace:read'), validate({ params: idParams }), async (req, res) => {
  const ws = await loadWorkspace(req, { write: true });
  await purgeWorkspace(ws.account, ws._id);
  await ws.deleteOne();
  res.status(204).end();
});

export default router;

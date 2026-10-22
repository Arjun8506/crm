import { Router } from 'express';
import { z } from 'zod';
import { authenticate, humansOnly, requirePermission } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { audit } from '../audit/audit.js';
import { Workspace } from '../workspaces/workspace.model.js';
import { ApiKey, API_KEY_PREFIX, generateKey, hashKey } from './apikey.model.js';

// Managing keys is for account admins signed in as a person: a key can never mint or revoke keys.
const router = Router();
router.use(authenticate, humansOnly, requirePermission('account:update'));

router.get('/', async (req, res) => {
  const keys = await ApiKey.find({ account: req.auth.accountId }).sort({ createdAt: -1 }).populate('createdBy', 'name').lean();
  res.json({ data: keys });
});

router.post(
  '/',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(80), scope: z.enum(['read', 'write']), workspaceIds: z.array(objectId).max(50).default([]),
      expiresInDays: z.number().int().min(1).max(730).nullable().default(null),
    }),
  }),
  async (req, res) => {
    const ids = [...new Set(req.body.workspaceIds)];
    if (ids.length && (await Workspace.countDocuments({ _id: { $in: ids }, account: req.auth.accountId })) !== ids.length) throw badRequest('One of the workspaces does not exist');
    const token = generateKey();
    const doc = await ApiKey.create({
      account: req.auth.accountId, name: req.body.name, scope: req.body.scope, workspaces: ids, createdBy: req.auth.userId,
      prefix: token.slice(0, API_KEY_PREFIX.length + 6), hash: hashKey(token),
      ...(req.body.expiresInDays ? { expiresAt: new Date(Date.now() + req.body.expiresInDays * 864e5) } : {}),
    });
    await audit(req, 'api_key.created', { type: 'api_key', id: doc._id, summary: `${doc.name} (${doc.scope})` });
    const { hash: _h, ...safe } = doc.toObject();
    res.status(201).json({ apiKey: safe, key: token });
  },
);

router.delete('/:id', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const key = await ApiKey.findOneAndUpdate({ _id: req.params.id, account: req.auth.accountId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  if (!key) throw notFound('API key not found');
  await audit(req, 'api_key.revoked', { type: 'api_key', id: key._id, summary: key.name });
  res.status(204).end();
});

export default router;

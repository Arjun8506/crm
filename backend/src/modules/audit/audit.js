import mongoose from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

// A record of sensitive actions (credentials, access, automation, data operations) for account admins.
const auditSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  apiKey: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey' },
  action: { type: String, required: true, maxlength: 60 },
  targetType: { type: String, maxlength: 40 },
  targetId: { type: String, maxlength: 60 },
  summary: { type: String, maxlength: 300 },
  ip: { type: String, maxlength: 64 },
  at: { type: Date, default: Date.now, index: { expireAfterSeconds: 400 * 86400 } },
});
auditSchema.index({ account: 1, at: -1 });
auditSchema.index({ account: 1, action: 1, at: -1 });

export const AuditLog = mongoose.model('AuditLog', auditSchema);

// Never throws: failing to write an audit entry must not break the action it describes (it is logged instead).
export async function audit(req, action, { type, id, summary } = {}) {
  try {
    await AuditLog.create({
      account: req.auth.accountId, user: req.auth.apiKey ? undefined : req.auth.userId, apiKey: req.auth.apiKey?.id, action,
      targetType: type, targetId: id ? String(id) : undefined, summary: summary?.slice(0, 300), ip: req.ip,
    });
  } catch (err) {
    console.error('[audit] could not write entry:', err.message);
  }
}

const router = Router();
router.use(authenticate, requirePermission('account:update'));

router.get('/', validate({ query: z.object({ action: z.string().max(60).optional(), page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(100).default(30) }) }), async (req, res) => {
  const q = { account: req.auth.accountId, ...(req.query.action ? { action: req.query.action } : {}) };
  const { page, limit } = req.query;
  const [data, total, actions] = await Promise.all([
    AuditLog.find(q).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).populate('user', 'name email').populate('apiKey', 'name prefix').lean(),
    AuditLog.countDocuments(q),
    AuditLog.distinct('action', { account: req.auth.accountId }),
  ]);
  res.json({ data, total, page, limit, actions: actions.sort() });
});

export default router;

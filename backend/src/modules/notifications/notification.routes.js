import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { notFound } from '../../utils/errors.js';
import { emailConfigured } from '../../providers/email.js';
import { User } from '../users/user.model.js';
import { DeviceToken, NOTIFICATION_TYPES, Notification } from './notification.model.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate({ query: z.object({ unread: z.enum(['true', 'false']).optional(), page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }) }),
  async (req, res) => {
    const q = { user: req.auth.userId, ...(req.query.unread === 'true' ? { readAt: null } : {}) };
    const { page, limit } = req.query;
    const [data, total, unread] = await Promise.all([
      Notification.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('actor', 'name').lean(),
      Notification.countDocuments(q),
      Notification.countDocuments({ user: req.auth.userId, readAt: null }),
    ]);
    res.json({ data, total, unread, page, limit });
  },
);

router.get('/unread-count', async (req, res) => {
  res.json({ unread: await Notification.countDocuments({ user: req.auth.userId, readAt: null }) });
});

router.post('/read-all', async (req, res) => {
  const r = await Notification.updateMany({ user: req.auth.userId, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ updated: r.modifiedCount });
});

router.post('/:id/read', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.auth.userId }, { $set: { readAt: new Date() } }, { returnDocument: 'after' });
  if (!n) throw notFound();
  res.json({ notification: n });
});

router.delete('/:id', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const r = await Notification.deleteOne({ _id: req.params.id, user: req.auth.userId });
  if (!r.deletedCount) throw notFound();
  res.status(204).end();
});

// ---- preferences ----
const flags = z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean());
router.get('/preferences', async (req, res) => {
  const user = await User.findById(req.auth.userId).select('preferences').lean();
  res.json({ types: NOTIFICATION_TYPES, preferences: user.preferences?.notifications ?? {}, emailConfigured: emailConfigured() });
});
router.put('/preferences', validate({ body: z.object({ inApp: flags.default({}), email: flags.default({}) }) }), async (req, res) => {
  await User.updateOne({ _id: req.auth.userId }, { $set: { 'preferences.notifications': { inApp: req.body.inApp, email: req.body.email } } });
  res.json({ preferences: req.body, emailConfigured: emailConfigured() });
});

// ---- push device registration (integration point only: nothing sends to these tokens yet) ----
router.post('/push/devices', validate({ body: z.object({ platform: z.enum(['webpush', 'fcm', 'apns']), token: z.string().min(8).max(2000) }) }), async (req, res) => {
  await DeviceToken.updateOne({ user: req.auth.userId, ...req.body }, { $setOnInsert: { account: req.auth.accountId } }, { upsert: true });
  res.status(201).json({ registered: true, deliveryConfigured: false });
});
router.delete('/push/devices', validate({ body: z.object({ platform: z.enum(['webpush', 'fcm', 'apns']), token: z.string().max(2000) }) }), async (req, res) => {
  await DeviceToken.deleteOne({ user: req.auth.userId, ...req.body });
  res.status(204).end();
});

export default router;

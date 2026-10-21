import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = ['mention', 'comment', 'record_update', 'task_assigned', 'task_comment', 'task_reminder', 'task_due', 'task_overdue', 'attachment', 'message_received', 'workflow', 'workflow_failed'];

const notificationSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  title: { type: String, required: true, maxlength: 200 },
  body: { type: String, default: '', maxlength: 300 },
  link: { type: String, default: '', maxlength: 300 },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 180 * 86400 } },
});
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

// Registered mobile / browser push tokens. Delivery adapters for FCM / APNS / Web Push are not implemented:
// these rows are the integration point such adapters would read from.
const deviceSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  platform: { type: String, enum: ['webpush', 'fcm', 'apns'], required: true },
  token: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now },
});
deviceSchema.index({ user: 1, platform: 1, token: 1 }, { unique: true });

export const Notification = mongoose.model('Notification', notificationSchema);
export const DeviceToken = mongoose.model('DeviceToken', deviceSchema);

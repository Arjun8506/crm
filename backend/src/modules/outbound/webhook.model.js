import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const EVENTS = [
  'record.created', 'record.updated', 'record.deleted', 'task.created', 'task.updated', 'task.deleted',
  'comment.created', 'attachment.created', 'attachment.deleted',
];

const hookSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: 'Account', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    url: { type: String, required: true, maxlength: 500 },
    events: { type: [{ type: String, enum: EVENTS }], default: [] },
    // Empty = every dataform. Otherwise record, comment and file events only for these.
    dataforms: { type: [ObjectId], default: [] },
    secret: { type: String, required: true, select: false }, // encrypted; signs every delivery
    enabled: { type: Boolean, default: true },
    // Consecutive deliveries that failed for good. At 10 the webhook switches itself off.
    failureCount: { type: Number, default: 0 },
    disabledReason: { type: String, maxlength: 200 },
    lastDeliveryAt: Date,
    lastStatus: { type: String, enum: ['ok', 'failed'] },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
hookSchema.index({ account: 1, enabled: 1, events: 1 });

const deliverySchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  webhook: { type: ObjectId, ref: 'OutboundWebhook', required: true },
  event: { type: String, required: true },
  // Same id on every retry and redelivery, so receivers can ignore duplicates.
  eventId: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['queued', 'succeeded', 'failed'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  responseStatus: Number,
  error: { type: String, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
  deliveredAt: Date,
  expireAt: { type: Date, default: () => new Date(Date.now() + 30 * 864e5), index: { expireAfterSeconds: 0 } },
});
deliverySchema.index({ webhook: 1, createdAt: -1 });

export const OutboundWebhook = mongoose.model('OutboundWebhook', hookSchema);
export const WebhookDelivery = mongoose.model('WebhookDelivery', deliverySchema);

import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// One entry on a record's communication timeline: an email, SMS, WhatsApp or Slack message, or a logged call / note.
const interactionSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: 'Account', required: true },
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    dataform: { type: ObjectId, ref: 'Dataform', required: true },
    record: { type: ObjectId, ref: 'Record', required: true },
    channel: { type: String, enum: ['email', 'sms', 'whatsapp', 'slack', 'call', 'note'], required: true },
    direction: { type: String, enum: ['outbound', 'inbound'], default: 'outbound' },
    // queued -> sent -> delivered | failed.  inbound messages are "received".  calls/notes are "logged".
    status: { type: String, enum: ['queued', 'sent', 'delivered', 'failed', 'received', 'logged'], required: true },
    to: { type: String, maxlength: 320 },
    from: { type: String, maxlength: 320 },
    subject: { type: String, maxlength: 300 },
    body: { type: String, default: '', maxlength: 10000 },
    error: { type: String, maxlength: 500 },
    providerId: { type: String, maxlength: 100 },
    // Call logs
    outcome: { type: String, maxlength: 60 },
    durationSec: { type: Number, min: 0, max: 86400 },
    user: { type: ObjectId, ref: 'User' },
    workflow: { type: ObjectId, ref: 'Workflow' },
  },
  { timestamps: true },
);
interactionSchema.index({ account: 1, record: 1, createdAt: -1 });
interactionSchema.index({ account: 1, providerId: 1 }, { sparse: true });

const templateSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: 'Account', required: true },
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    channel: { type: String, enum: ['email', 'sms', 'whatsapp'], required: true },
    subject: { type: String, default: '', maxlength: 300 },
    body: { type: String, required: true, maxlength: 10000 },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
templateSchema.index({ account: 1, workspace: 1, channel: 1 });

export const Interaction = mongoose.model('Interaction', interactionSchema);
export const Template = mongoose.model('Template', templateSchema);

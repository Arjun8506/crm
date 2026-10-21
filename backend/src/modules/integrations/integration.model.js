import mongoose from 'mongoose';

export const KINDS = ['slack', 'twilio', 'smtp'];

// One document per (account, kind). Credentials live encrypted in `secrets`; they are never returned by the API.
const integrationSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    kind: { type: String, enum: KINDS, required: true },
    enabled: { type: Boolean, default: true },
    secrets: { type: String, required: true, select: false },
    // Non-secret options, e.g. the Twilio sender numbers or the email From address.
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Shared secret for inbound webhooks (inbound email). Encrypted like the credentials.
    webhookSecret: { type: String, select: false },
    status: {
      lastTestAt: Date,
      ok: Boolean,
      error: { type: String, maxlength: 500 },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
integrationSchema.index({ account: 1, kind: 1 }, { unique: true });

export const Integration = mongoose.model('Integration', integrationSchema);

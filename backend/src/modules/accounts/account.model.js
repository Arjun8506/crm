import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    plan: { type: String, enum: ['free', 'team', 'business'], default: 'free' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    settings: {
      timezone: { type: String, default: 'UTC' },
      industry: { type: String, default: '', maxlength: 80 },
    },
    // Entitlements are resolved from the plan; stored here so they can be overridden per account.
    entitlements: {
      maxWorkspaces: { type: Number, default: 5 },
      maxUsers: { type: Number, default: 10 },
      maxUploadMb: { type: Number, default: 25 },
    },
    onboarding: { completedAt: Date },
  },
  { timestamps: true },
);

export const Account = mongoose.model('Account', accountSchema);

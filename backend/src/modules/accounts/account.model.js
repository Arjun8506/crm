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
      // AI assistance sends selected record text to an external AI provider, so an admin must switch it on.
      aiEnabled: { type: Boolean, default: false },
      // Anonymous product-usage events (page and feature names only). Admins can switch it off for everyone.
      analytics: { type: Boolean, default: true },
    },
    // Entitlements are resolved from the plan; stored here so they can be overridden per account.
    // Legacy: replaced by config/plans.js plus entitlementOverrides. Kept so older documents still load; no longer read.
    entitlements: { type: mongoose.Schema.Types.Mixed, select: false },
    // Per-account exceptions to the plan's limits, e.g. { maxUsers: 100 } granted by support.
    entitlementOverrides: { type: mongoose.Schema.Types.Mixed, default: undefined },
    onboarding: { completedAt: Date, dismissedAt: Date },
  },
  { timestamps: true },
);

export const Account = mongoose.model('Account', accountSchema);

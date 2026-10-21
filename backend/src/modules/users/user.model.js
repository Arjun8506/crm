import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
    defaultAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      // { inApp: { <type>: bool }, email: { <type>: bool } }. In-app defaults to on, email to off.
      notifications: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);

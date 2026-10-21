import mongoose from 'mongoose';
import { ROLES } from '../../config/permissions.js';

const membershipSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, default: 'member' },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  },
  { timestamps: true },
);
membershipSchema.index({ account: 1, user: 1 }, { unique: true });
membershipSchema.index({ user: 1 });

export const Membership = mongoose.model('Membership', membershipSchema);

import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true },
    description: { type: String, default: '', maxlength: 500 },
    color: { type: String, default: '#4f46e5' },
    // 'account': every account member can see it. 'private': only listed members and admins.
    visibility: { type: String, enum: ['account', 'private'], default: 'account' },
    // Bounded in practice by the account's maxUsers entitlement.
    members: [
      {
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: ['admin', 'editor', 'viewer'], default: 'editor' },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
workspaceSchema.index({ account: 1, slug: 1 }, { unique: true });
workspaceSchema.index({ account: 1, 'members.user': 1 });

export const Workspace = mongoose.model('Workspace', workspaceSchema);

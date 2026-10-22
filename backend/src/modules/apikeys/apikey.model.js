import crypto from 'node:crypto';
import mongoose from 'mongoose';

export const API_KEY_PREFIX = 'ocrm_';
export const hashKey = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const generateKey = () => `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;

// Only a SHA-256 hash of the key is stored (keys are long random values, so a fast hash is appropriate).
// The full key is shown once, when it is created.
const apiKeySchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    prefix: { type: String, required: true }, // first characters, to recognise a key in a list
    hash: { type: String, required: true, unique: true, select: false },
    // 'read': GET and read-only queries. 'write': also create, edit and delete records.
    scope: { type: String, enum: ['read', 'write'], required: true },
    // Empty = every workspace the key's access level can see. Otherwise only these.
    workspaces: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    expiresAt: Date,
    revokedAt: Date,
    lastUsedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
apiKeySchema.index({ account: 1, revokedAt: 1 });

export const ApiKey = mongoose.model('ApiKey', apiKeySchema);

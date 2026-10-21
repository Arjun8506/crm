import mongoose from 'mongoose';

// Refresh sessions: only a SHA-256 hash of the opaque token is stored.
const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  tokenHash: { type: String, required: true, unique: true },
  userAgent: { type: String, maxlength: 300 },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  createdAt: { type: Date, default: Date.now },
});

export const Session = mongoose.model('Session', sessionSchema);

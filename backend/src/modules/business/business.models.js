import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// Product feedback and support questions. Stored in the app for the organisation's admins; optionally also emailed.
const feedbackSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  user: { type: ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['idea', 'bug', 'question', 'praise'], required: true },
  message: { type: String, required: true, maxlength: 2000 },
  page: { type: String, maxlength: 200 },
  status: { type: String, enum: ['new', 'seen', 'planned', 'done', 'closed'], default: 'new' },
  emailed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
feedbackSchema.index({ account: 1, createdAt: -1 });
feedbackSchema.index({ account: 1, user: 1, createdAt: -1 });

// News written by an organisation's admins for their own members.
const announcementSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  title: { type: String, required: true, maxlength: 120 },
  body: { type: String, default: '', maxlength: 2000 },
  createdBy: { type: ObjectId, ref: 'User' },
  publishedAt: { type: Date, default: Date.now },
  expiresAt: Date,
});
announcementSchema.index({ account: 1, publishedAt: -1 });

// A score of 0-10, or a dismissal (score null) so people are not asked again straight away.
const npsSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  user: { type: ObjectId, ref: 'User', required: true },
  score: { type: Number, min: 0, max: 10, default: null },
  dismissed: { type: Boolean, default: false },
  comment: { type: String, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now },
});
npsSchema.index({ account: 1, user: 1, createdAt: -1 });

// One row per page view or feature use. No content, no IP, no user agent. `actor` is a one-way pseudonym, so
// admins can count distinct people without being able to see who they are, and a person can still delete their own events.
const usageSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  actor: { type: String, required: true },
  name: { type: String, required: true, maxlength: 60 },
  at: { type: Date, default: Date.now, index: { expireAfterSeconds: 180 * 86400 } },
});
usageSchema.index({ account: 1, at: -1 });
usageSchema.index({ account: 1, actor: 1 });

export const Feedback = mongoose.model('Feedback', feedbackSchema);
export const Announcement = mongoose.model('Announcement', announcementSchema);
export const NpsResponse = mongoose.model('NpsResponse', npsSchema);
export const UsageEvent = mongoose.model('UsageEvent', usageSchema);

import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// One per account that has (or had) a paid plan. Free accounts have no subscription document.
const subscriptionSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true, unique: true },
  plan: { type: String, required: true },
  status: { type: String, enum: ['active', 'past_due', 'canceled'], default: 'active' },
  provider: { type: String, required: true },
  providerCustomerId: String,
  providerSubscriptionId: { type: String, index: true, sparse: true },
  currentPeriodEnd: Date,
  // Scheduled changes, applied at the end of the paid period.
  cancelAtPeriodEnd: { type: Boolean, default: false },
  pendingPlan: String,
  startedAt: { type: Date, default: Date.now },
  canceledAt: Date,
}, { timestamps: true });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

// A started checkout. It stays 'pending' until the provider confirms; only then does the plan change.
const checkoutSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  user: { type: ObjectId, ref: 'User' },
  plan: { type: String, required: true },
  provider: { type: String, required: true },
  providerSessionId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 90 * 86400 } },
});
checkoutSchema.index({ account: 1, createdAt: -1 });

const invoiceSchema = new mongoose.Schema({
  account: { type: ObjectId, required: true },
  provider: String,
  providerInvoiceId: { type: String, required: true },
  number: String,
  plan: String,
  amount: { type: Number, required: true }, // cents
  currency: { type: String, default: 'usd' },
  status: { type: String, enum: ['paid', 'failed'], required: true },
  hostedUrl: String,
  periodStart: Date,
  periodEnd: Date,
  createdAt: { type: Date, default: Date.now },
});
invoiceSchema.index({ account: 1, createdAt: -1 });
invoiceSchema.index({ provider: 1, providerInvoiceId: 1, status: 1 }, { unique: true });

// Every webhook event id we have handled, so a provider that delivers twice never charges or upgrades twice.
const eventSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  eventId: { type: String, required: true },
  type: String,
  at: { type: Date, default: Date.now, index: { expireAfterSeconds: 90 * 86400 } },
});
eventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
export const CheckoutSession = mongoose.model('CheckoutSession', checkoutSchema);
export const Invoice = mongoose.model('Invoice', invoiceSchema);
export const BillingEvent = mongoose.model('BillingEvent', eventSchema);

import { env, isProd } from '../../config/env.js';
import { stripeProvider } from './stripe.js';
import { testProvider } from './test.js';

// Payment provider abstraction. A provider offers:
//   createCheckout({ account, plan, successUrl, cancelUrl, email }) -> { sessionId, url }
//   cancelSubscription({ providerSubscriptionId, atPeriodEnd }), resumeSubscription({ providerSubscriptionId })
//   verifyWebhook(rawBody, headers) -> { id, type, data } | { type: null } | null (bad signature)
// Events use one shared vocabulary: checkout.completed, checkout.failed, invoice.paid, invoice.failed, subscription.canceled.
const providers = { test: testProvider, stripe: stripeProvider };

// The simulated provider is for development only: in production, billing is off unless a real provider is configured.
export function activeProvider() {
  const name = env.BILLING_PROVIDER ?? (isProd ? 'none' : 'test');
  if (name === 'none' || (name === 'test' && isProd)) return null;
  return providers[name];
}

export const providerByName = (name) => providers[name] ?? null;

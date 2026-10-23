import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGO_URI: z.string().default('mongodb://127.0.0.1:27018/orgcrm'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Optional. Without SMTP_URL no email is sent and the UI says so; nothing is ever faked.
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('OrgCRM <no-reply@localhost>'),
  APP_URL: z.string().default('http://localhost:5173'),
  STORAGE_DIR: z.string().default('./storage'),
  // Encrypts integration credentials at rest. Set a long random value in production; falls back to a key derived from the JWT secret.
  SECRETS_KEY: z.string().min(16).optional(),
  // Public base URL of this API, shown to admins as the webhook URLs to give Twilio etc. and used to verify Twilio signatures.
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  // Outbound webhooks to private / loopback addresses are blocked (SSRF protection). Enable only for local development.
  ALLOW_PRIVATE_WEBHOOKS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Billing. 'test' simulates a payment provider (development only: refused in production); 'stripe' talks to Stripe; 'none' hides checkout.
  BILLING_PROVIDER: z.enum(['test', 'stripe', 'none']).optional(),
  BILLING_WEBHOOK_SECRET: z.string().min(16).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_TEAM: z.string().optional(),
  STRIPE_PRICE_BUSINESS: z.string().optional(),
  // AI assistance. Without a key the AI features are simply unavailable.
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  // Only change this to reach the API through a gateway or proxy you run.
  AI_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  // Optional: where product feedback and support requests are also emailed (needs SMTP). They are always stored in the app.
  SUPPORT_EMAIL: z.string().email().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { getMailer } from '../../providers/email.js';
import { Integration } from './integration.model.js';
import { decrypt } from './secrets.js';

// Returns the decrypted configuration for an enabled integration, or null when it is missing or switched off.
export async function getIntegration(accountId, kind) {
  const doc = await Integration.findOne({ account: accountId, kind, enabled: true }).select('+secrets').lean();
  if (!doc) return null;
  return { id: String(doc._id), settings: doc.settings ?? {}, secrets: decrypt(doc.secrets) };
}

// Which channels can actually send for this account. The UI uses this to disable what is not set up.
export async function channelStatus(accountId) {
  const [twilio, slack, smtp] = await Promise.all([getIntegration(accountId, 'twilio'), getIntegration(accountId, 'slack'), getIntegration(accountId, 'smtp')]);
  return {
    email: { configured: !!smtp || !!getMailer(), source: smtp ? 'account' : getMailer() ? 'server' : null },
    sms: { configured: !!twilio?.settings.smsFrom },
    whatsapp: { configured: !!twilio?.settings.whatsappFrom },
    slack: { configured: !!slack },
  };
}

// Account SMTP integration first, then the server-wide SMTP_URL. Null when neither exists, so callers fail loudly.
export async function getAccountMailer(accountId) {
  const smtp = await getIntegration(accountId, 'smtp');
  if (smtp) {
    const transport = nodemailer.createTransport(smtp.secrets.url);
    return { send: (msg) => transport.sendMail(msg), from: smtp.settings.from || env.EMAIL_FROM, source: 'account', verify: () => transport.verify() };
  }
  const server = getMailer();
  return server ? { send: (msg) => server.send(msg), from: env.EMAIL_FROM, source: 'server' } : null;
}

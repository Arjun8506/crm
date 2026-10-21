import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

// Email provider abstraction. Returns null when no transport is configured, so callers can report
// "not configured" instead of pretending a message was delivered.
let override;
let cached;

export const setMailer = (m) => { override = m; };

export function getMailer() {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  if (!env.SMTP_URL) { cached = null; return cached; }
  const transport = nodemailer.createTransport(env.SMTP_URL);
  cached = { send: (msg) => transport.sendMail({ from: env.EMAIL_FROM, ...msg }) };
  return cached;
}

export const emailConfigured = () => !!getMailer();

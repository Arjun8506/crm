import crypto from 'node:crypto';
import { env } from '../../config/env.js';

// AES-256-GCM for integration credentials at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
// The key comes from SECRETS_KEY (or, as a fallback for development, is derived from the JWT secret).
let key;
const getKey = () => (key ??= crypto.scryptSync(env.SECRETS_KEY ?? env.JWT_ACCESS_SECRET, 'orgcrm-secrets-v1', 32));

export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(token) {
  const [v, iv, tag, ct] = String(token ?? '').split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unreadable secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8'));
}

export const mask = (s) => (s ? `••••${String(s).slice(-4)}` : '');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

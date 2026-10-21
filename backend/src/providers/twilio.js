import crypto from 'node:crypto';
import { request } from './http.js';

// Twilio REST adapter for SMS and WhatsApp (WhatsApp uses the same Messages API with "whatsapp:" numbers).
const BASE = 'https://api.twilio.com/2010-04-01';
const auth = (sid, token) => `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;

async function twilioError(res) {
  const data = await res.json().catch(() => null);
  return new Error(`Twilio error ${data?.code ?? res.status}: ${data?.message ?? res.statusText}`);
}

export async function sendMessage({ accountSid, authToken, from, to, body, statusCallback }) {
  const form = new URLSearchParams({ From: from, To: to, Body: body });
  if (statusCallback) form.set('StatusCallback', statusCallback);
  const res = await request(`${BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: 'POST', headers: { Authorization: auth(accountSid, authToken), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
  });
  if (!res.ok) throw await twilioError(res);
  const data = await res.json();
  return { providerId: data.sid, status: data.status };
}

export async function verifyCredentials({ accountSid, authToken }) {
  const res = await request(`${BASE}/Accounts/${encodeURIComponent(accountSid)}.json`, { headers: { Authorization: auth(accountSid, authToken) } });
  if (!res.ok) throw await twilioError(res);
  const data = await res.json();
  if (data.status && data.status !== 'active') throw new Error(`The Twilio account is ${data.status}`);
  return data.friendly_name;
}

// Twilio signs webhooks with HMAC-SHA1 over the full URL plus the sorted POST parameters.
export function validateSignature(authToken, url, params, signature) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected); const b = Buffer.from(String(signature ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const signFor = (authToken, url, params) => crypto.createHmac('sha1', authToken).update(Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url)).digest('base64');

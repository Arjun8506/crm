import { request } from './http.js';

// Slack incoming webhooks. The URL is a credential, and is only ever posted to hooks.slack.com.
export function assertSlackUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a valid Slack webhook URL'); }
  if (u.protocol !== 'https:' || u.hostname !== 'hooks.slack.com' || !u.pathname.startsWith('/services/')) {
    throw new Error('Use an incoming-webhook URL from Slack (https://hooks.slack.com/services/...)');
  }
  return u.toString();
}

export async function postSlack(webhookUrl, text) {
  const res = await request(assertSlackUrl(webhookUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: String(text).slice(0, 3000) }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Slack rejected the message (${res.status}${body ? `: ${body.slice(0, 120)}` : ''})`);
  return { providerId: null };
}

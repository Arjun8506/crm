import { env } from '../config/env.js';
import { request } from './http.js';

// AI provider abstraction. One adapter today (Anthropic's Messages API over plain HTTPS). A different provider would
// implement the same complete() contract. The key never leaves the server; without one, AI features are unavailable.

export class AiError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}

export const aiConfigured = () => !!env.ANTHROPIC_API_KEY;
export const aiModel = () => env.AI_MODEL;

// Returns { text, truncated, model }. Provider failures become AiError with a message that is safe to show to a user.
export async function complete({ system, user, maxTokens = 800, temperature = 0.3 }) {
  if (!aiConfigured()) throw new AiError('NOT_CONFIGURED', 409, 'AI assistance is not set up on this server');
  let res;
  try {
    res = await request(`${env.AI_BASE_URL.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST', timeoutMs: env.AI_TIMEOUT_MS,
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.AI_MODEL, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new AiError('TIMEOUT', 504, 'The AI service took too long to answer. Please try again.');
    console.error('[ai] network error:', err?.message);
    throw new AiError('PROVIDER_UNAVAILABLE', 502, 'The AI service could not be reached. Please try again later.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[ai] provider error', res.status, body?.error?.type, body?.error?.message);
    if (res.status === 429) throw new AiError('PROVIDER_RATE_LIMIT', 429, 'The AI service is busy right now. Please try again in a minute.');
    if (res.status === 401 || res.status === 403) throw new AiError('PROVIDER_AUTH', 502, 'AI assistance is misconfigured on this server. Please tell an administrator.');
    throw new AiError('PROVIDER_ERROR', 502, 'The AI service could not complete that request.');
  }
  const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new AiError('EMPTY', 502, 'The AI service returned no answer. Please try again.');
  return { text, truncated: body.stop_reason === 'max_tokens', model: body.model ?? env.AI_MODEL };
}

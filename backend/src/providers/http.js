import dns from 'node:dns/promises';
import net from 'node:net';
import { env } from '../config/env.js';

// Outbound HTTP for webhooks and provider APIs. Fetch and DNS are injectable so tests never touch the network.
let fetchImpl = (...args) => globalThis.fetch(...args);
let lookupImpl = (host) => dns.lookup(host, { all: true });
export const setFetch = (fn) => { fetchImpl = fn ?? ((...args) => globalThis.fetch(...args)); };
export const setLookup = (fn) => { lookupImpl = fn ?? ((host) => dns.lookup(host, { all: true })); };

export class BlockedUrlError extends Error {}

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

// Rejects URLs that would let a workflow reach internal services (SSRF): non-https, credentials in the URL,
// and hostnames that resolve to private, loopback, link-local or metadata addresses.
export async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new BlockedUrlError('That is not a valid URL'); }
  if (env.ALLOW_PRIVATE_WEBHOOKS) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new BlockedUrlError('Only http and https URLs are allowed');
    return url;
  }
  if (url.protocol !== 'https:') throw new BlockedUrlError('Webhook URLs must use https');
  if (url.username || url.password) throw new BlockedUrlError('URLs with embedded credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await lookupImpl(host).catch(() => { throw new BlockedUrlError(`Could not resolve ${host}`); });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new BlockedUrlError('That address points to a private or internal network, which is not allowed');
  return url;
}

// Never follows redirects (a public URL could redirect to an internal one) and always has a timeout.
export async function request(url, { timeoutMs = 10_000, ...init } = {}) {
  return fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
}

export async function safeRequest(rawUrl, init) {
  const url = await assertPublicUrl(rawUrl);
  return request(url.toString(), init);
}

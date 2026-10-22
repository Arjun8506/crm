import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

// File storage adapter. Only the local-disk driver exists today; an S3-compatible driver would
// implement the same methods (put / stream / remove) and add presigned URLs.
const root = () => resolve(env.STORAGE_DIR);

const pathFor = (key) => {
  const full = resolve(root(), key);
  // Keys are server-generated; this is defence in depth against path traversal.
  if (!full.startsWith(root() + sep)) throw new Error('Invalid storage key');
  return full;
};

export const newKey = (accountId) => `${accountId}/${crypto.randomUUID()}`;

export async function put(key, buffer) {
  const full = pathFor(key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, buffer);
}
// Writes a readable stream to storage without buffering it in memory (exports can be large).
export async function putStream(key, readable) {
  const full = pathFor(key);
  await mkdir(dirname(full), { recursive: true });
  await pipeline(readable, createWriteStream(full));
}
export async function read(key) {
  const chunks = [];
  for await (const c of createReadStream(pathFor(key))) chunks.push(c);
  return Buffer.concat(chunks);
}
export const size = async (key) => (await stat(pathFor(key))).size;
export const stream = (key) => createReadStream(pathFor(key));
export const remove = (key) => rm(pathFor(key), { force: true });

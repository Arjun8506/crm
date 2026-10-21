import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
export const stream = (key) => createReadStream(pathFor(key));
export const remove = (key) => rm(pathFor(key), { force: true });

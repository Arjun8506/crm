import path from 'node:path';
import * as storage from '../../providers/storage.js';
import { badRequest } from '../../utils/errors.js';
import { Attachment } from './attachment.model.js';

const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'dll', 'sh', 'ps1', 'vbs', 'jar', 'app', 'apk']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// Real content check, not just the declared Content-Type: only genuine raster images are ever rendered inline.
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Strips directories, control characters and characters that are unsafe in file names or headers.
export function cleanName(name) {
  let out = '';
  for (const ch of path.basename(String(name))) {
    const code = ch.codePointAt(0);
    out += code < 32 || code === 127 || '"\\/:*?<>|'.includes(ch) ? '_' : ch;
  }
  return out.replace(/^\.+/, '').slice(0, 200) || 'file';
}

// Validates and stores one uploaded file against a record. `uploader` is undefined for anonymous public-form uploads.
export async function saveAttachment({ dataform, record, uploader, file, description = '' }) {
  const filename = cleanName(file.originalname);
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (BLOCKED_EXT.has(ext)) throw badRequest(`.${ext} files cannot be uploaded`);
  if (file.size === 0) throw badRequest('The file is empty');
  const sniffed = sniffImage(file.buffer);
  const previewable = !!sniffed && sniffed === file.mimetype && IMAGE_TYPES.has(sniffed);
  const storageKey = storage.newKey(dataform.account);
  await storage.put(storageKey, file.buffer);
  const attachment = await Attachment.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, record: record._id, uploader,
    filename, mimeType: previewable ? sniffed : (file.mimetype || 'application/octet-stream').slice(0, 120), size: file.size, description: description.slice(0, 300), previewable, storageKey,
  });
  const { storageKey: _k, ...safe } = attachment.toObject();
  return { attachment, safe };
}

import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { ApiError, badRequest, forbidden, notFound } from '../../utils/errors.js';
import * as storage from '../../providers/storage.js';
import { emitWorkspace } from '../../sockets/index.js';
import { Account } from '../accounts/account.model.js';
import { entitlementsOf } from '../billing/entitlements.js';
import { autoFollow, followersOf, recordLabel } from '../comments/comment.service.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { notify } from '../notifications/notification.service.js';
import { dispatchEvent } from '../outbound/events.js';
import { LEVEL, workspaceAccess } from '../workspaces/access.js';
import { Attachment } from './attachment.model.js';
import { saveAttachment } from './attachment.service.js';

const MAX_ZIP_FILES = 100;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;

// ---- record attachments: mounted at /dataforms/:id/records/:recordId/attachments ----
export const recordAttachmentRouter = Router({ mergeParams: true });
recordAttachmentRouter.use(authenticate);
const recordParams = z.object({ id: objectId, recordId: objectId });

// Authorization runs BEFORE the upload is read, so unauthorized callers cannot make the server buffer files.
async function prepareUpload(req, _res, next) {
  const ctx = await loadDataform(req, 'editor');
  if (ctx.dataform.status === 'archived') throw new ApiError(409, 'CONFLICT', 'This dataform is archived and read-only');
  const { record, name } = await recordLabel(ctx.dataform, req.params.recordId);
  const account = await Account.findById(ctx.dataform.account).lean();
  req.upload = { ...ctx, record, recordName: name, maxMb: entitlementsOf(account).maxUploadMb };
  next();
}
function receiveFile(req, res, next) {
  const { maxMb } = req.upload;
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 5 } }).single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'FILE_TOO_LARGE', `Files can be at most ${maxMb} MB on your plan`));
    return next(err);
  });
}

recordAttachmentRouter.get('/attachments', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  await recordLabel(dataform, req.params.recordId);
  const data = await Attachment.find({ account: dataform.account, record: req.params.recordId }).sort({ createdAt: -1 }).populate('uploader', 'name').lean();
  res.json({ data, maxUploadMb: entitlementsOf(await Account.findById(dataform.account).lean()).maxUploadMb });
});

recordAttachmentRouter.post('/attachments', validate({ params: recordParams }), prepareUpload, receiveFile, async (req, res) => {
  const { dataform, access, record, recordName } = req.upload;
  const file = req.file;
  if (!file) throw badRequest('Choose a file to upload (form field "file")');
  const description = typeof req.body.description === 'string' ? req.body.description : '';
  const { attachment, safe } = await saveAttachment({ dataform, record, uploader: req.auth.userId, file, description });
  const { filename } = attachment;
  await autoFollow({ workspace: access.workspace, dataform: dataform._id, record: record._id, userIds: [req.auth.userId] });
  await notify({
    account: dataform.account, recipients: await followersOf(record._id), actor: req.auth.userId, type: 'attachment',
    title: `A file was added to ${recordName}`, body: filename, link: `/w/${dataform.workspace}/f/${dataform._id}?record=${record._id}`,
  });
  emitWorkspace(dataform.workspace, 'attachment.changed', { dataformId: String(dataform._id), recordId: String(record._id) });
  await dispatchEvent({ account: dataform.account, event: 'attachment.created', dataformId: dataform._id, data: { attachmentId: String(attachment._id), filename, size: attachment.size, mimeType: attachment.mimeType, recordId: String(record._id), dataformId: String(dataform._id), workspaceId: String(dataform.workspace) } });
  res.status(201).json({ attachment: safe });
});

recordAttachmentRouter.post('/attachments/zip', validate({ params: recordParams, body: z.object({ ids: z.array(objectId).max(MAX_ZIP_FILES).optional() }) }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  await recordLabel(dataform, req.params.recordId);
  const filter = { account: dataform.account, record: req.params.recordId, ...(req.body.ids?.length ? { _id: { $in: req.body.ids } } : {}) };
  const files = await Attachment.find(filter).select('+storageKey').limit(MAX_ZIP_FILES).lean();
  if (files.length === 0) throw notFound('No attachments to download');
  if (files.reduce((n, f) => n + f.size, 0) > MAX_ZIP_BYTES) throw new ApiError(413, 'TOO_LARGE', 'The selected files are too large to download together. Select fewer files.');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${dataform.slug}-attachments.zip"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', () => res.destroy());
  archive.pipe(res);
  const used = new Map();
  for (const f of files) {
    const n = used.get(f.filename) ?? 0;
    used.set(f.filename, n + 1);
    const name = n ? `${path.parse(f.filename).name} (${n})${path.extname(f.filename)}` : f.filename;
    archive.append(storage.stream(f.storageKey), { name });
  }
  await archive.finalize();
});

// ---- single attachment: mounted at /attachments ----
const router = Router();
router.use(authenticate);
const idParams = z.object({ id: objectId });

async function load(req, { minLevel = 'viewer', withKey = false } = {}) {
  const attachment = await Attachment.findOne({ _id: req.params.id, account: req.auth.accountId }).select(withKey ? '+storageKey' : '');
  if (!attachment) throw notFound('Attachment not found');
  const access = await workspaceAccess(req.auth, attachment.workspace, minLevel);
  return { attachment, access };
}

router.get('/:id/download', validate({ params: idParams, query: z.object({ inline: z.enum(['1']).optional() }) }), async (req, res) => {
  const { attachment } = await load(req, { withKey: true });
  const inline = req.query.inline === '1' && attachment.previewable;
  res.setHeader('Content-Type', attachment.previewable ? attachment.mimeType : 'application/octet-stream');
  res.setHeader('Content-Length', attachment.size);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  const stream = storage.stream(attachment.storageKey);
  stream.on('error', () => (res.headersSent ? res.destroy() : res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The file is missing from storage' } })));
  stream.pipe(res);
});

router.patch('/:id', validate({ params: idParams, body: z.object({ description: z.string().trim().max(300) }) }), async (req, res) => {
  const { attachment, access } = await load(req, { minLevel: 'editor' });
  if (String(attachment.uploader) !== req.auth.userId && access.level < LEVEL.admin) throw forbidden('Only the uploader or a workspace admin can change this file');
  attachment.description = req.body.description;
  await attachment.save();
  res.json({ attachment });
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const { attachment, access } = await load(req, { minLevel: 'editor', withKey: true });
  if (String(attachment.uploader) !== req.auth.userId && access.level < LEVEL.admin) throw forbidden('Only the uploader or a workspace admin can delete this file');
  await storage.remove(attachment.storageKey);
  await attachment.deleteOne();
  emitWorkspace(attachment.workspace, 'attachment.changed', { dataformId: String(attachment.dataform), recordId: String(attachment.record) });
  await dispatchEvent({ account: attachment.account, event: 'attachment.deleted', dataformId: attachment.dataform, data: { attachmentId: String(attachment._id), filename: attachment.filename, recordId: String(attachment.record), dataformId: String(attachment.dataform), workspaceId: String(attachment.workspace) } });
  res.status(204).end();
});

export default router;

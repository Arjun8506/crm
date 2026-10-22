import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, humansOnly } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import * as storage from '../../providers/storage.js';
import { ApiError, badRequest, conflict, notFound } from '../../utils/errors.js';
import { audit } from '../audit/audit.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { enqueue } from '../queue/queue.js';
import { LEVEL, workspaceAccess } from '../workspaces/access.js';
import { loadFields } from '../records/record.service.js';
import { suggestMapping } from './convert.js';
import { CsvError, parseCsv } from './csvParse.js';
import { MAX_IMPORT_MB, MAX_IMPORT_ROWS, importable } from './import.service.js';
import { ImportJob } from './job.models.js';

const PREVIEW_ROWS = 5;
const present = (j) => { const o = j.toObject ? j.toObject() : j; const { storageKey: _s, errorsKey: _e, ...rest } = o; return rest; };
const fieldInfo = (f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, unique: f.unique });

// ---- upload + history: mounted at /dataforms/:id/imports ----
export const dataformImportRouter = Router({ mergeParams: true });
dataformImportRouter.use(authenticate, humansOnly);

dataformImportRouter.get('/', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  const data = await ImportJob.find({ account: dataform.account, dataform: dataform._id }).sort({ createdAt: -1 }).limit(25).populate('user', 'name').lean();
  res.json({ data: data.map(present) });
});

// Authorization first, so unauthorized callers cannot make the server buffer a file.
async function prepare(req, _res, next) {
  const ctx = await loadDataform(req, 'editor');
  if (ctx.dataform.status === 'archived') throw conflict('This dataform is archived and read-only');
  req.target = ctx;
  next();
}
const receive = (req, res, next) => multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_MB * 1024 * 1024, files: 1, fields: 5 } }).single('file')(req, res, (err) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'FILE_TOO_LARGE', `Import files can be at most ${MAX_IMPORT_MB} MB`));
  return next(err);
});

dataformImportRouter.post('/', validate({ params: z.object({ id: objectId }) }), prepare, receive, async (req, res) => {
  const { dataform } = req.target;
  if (!req.file) throw badRequest('Choose a CSV file to import (form field "file")');
  const ext = path.extname(req.file.originalname).slice(1).toLowerCase();
  if (!['csv', 'txt', 'tsv'].includes(ext)) throw badRequest('Only .csv files can be imported');
  let parsed;
  try { parsed = parseCsv(req.file.buffer.toString('utf8'), { maxRows: MAX_IMPORT_ROWS }); } catch (e) {
    if (e instanceof CsvError) throw badRequest(e.message);
    throw e;
  }
  const [header, ...rows] = parsed.rows;
  if (!header || header.every((h) => !h.trim())) throw badRequest('The first row must contain column headings');
  if (rows.length === 0) throw badRequest('The file has headings but no data rows');
  const headers = header.map((h, i) => h.trim() || `Column ${i + 1}`);
  const fields = importable(await loadFields(dataform._id));

  const key = storage.newKey(dataform.account);
  await storage.put(key, req.file.buffer);
  const job = await ImportJob.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, user: req.auth.userId, filename: path.basename(req.file.originalname).slice(0, 200),
    storageKey: key, delimiter: parsed.delimiter, headers, sample: rows.slice(0, PREVIEW_ROWS), rowCount: rows.length,
  });
  res.status(201).json({ import: present(job), fields: fields.map(fieldInfo), suggestedMapping: suggestMapping(headers, fields) });
});

// ---- job-level: mounted at /imports ----
const router = Router();
router.use(authenticate, humansOnly);
const idParams = z.object({ id: objectId });

async function load(req, minLevel = 'viewer', select = '') {
  const job = await ImportJob.findOne({ _id: req.params.id, account: req.auth.accountId }).select(select);
  if (!job) throw notFound('Import not found');
  const access = await workspaceAccess(req.auth, job.workspace, minLevel);
  // Imports belong to the person who started them; workspace admins can see and stop them too.
  if (String(job.user) !== req.auth.userId && access.level < LEVEL.admin) throw notFound('Import not found');
  return { job, access };
}

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const { job } = await load(req);
  const fields = importable(await loadFields(job.dataform));
  res.json({ import: present(job), fields: fields.map(fieldInfo) });
});

const startBody = z.object({
  mapping: z.array(z.object({ column: z.number().int().min(0).max(500), field: z.string().max(60) })).min(1, 'Map at least one column').max(100),
  duplicate: z.enum(['skip', 'update', 'error']).default('skip'),
  matchField: z.string().max(60).optional(),
  dateFormat: z.enum(['iso', 'dmy', 'mdy']).default('iso'),
  dryRun: z.boolean().default(false),
});

router.post('/:id/start', validate({ params: idParams, body: startBody }), async (req, res) => {
  const { job } = await load(req, 'editor');
  if (!(job.status === 'uploaded' || (job.status === 'done' && job.dryRun))) throw conflict('This import has already been started');
  const dataform = await Dataform.findOne({ _id: job.dataform, account: job.account });
  if (!dataform) throw notFound('Dataform not found');
  if (dataform.status === 'archived') throw conflict('This dataform is archived and read-only');
  const fields = importable(await loadFields(job.dataform));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const { mapping, duplicate, matchField, dateFormat, dryRun } = req.body;

  const errors = [];
  if (new Set(mapping.map((m) => m.column)).size !== mapping.length) errors.push({ path: 'mapping', message: 'A column can only be mapped once' });
  if (new Set(mapping.map((m) => m.field)).size !== mapping.length) errors.push({ path: 'mapping', message: 'A field can only be filled from one column' });
  for (const m of mapping) {
    if (m.column >= job.headers.length) errors.push({ path: 'mapping', message: `Column ${m.column + 1} does not exist` });
    if (!byKey.has(m.field)) errors.push({ path: 'mapping', message: `${m.field} is not a field that can be imported into` });
  }
  const mapped = new Set(mapping.map((m) => m.field));
  for (const f of fields) if (f.required && !mapped.has(f.key) && (f.defaultValue === undefined || f.defaultValue === null || f.defaultValue === '')) errors.push({ path: 'mapping', message: `Map a column to "${f.label}" (it is required)` });
  if (matchField && !mapped.has(matchField)) errors.push({ path: 'matchField', message: 'The field used to find existing records must be mapped to a column' });
  if (errors.length) throw badRequest(errors[0].message, errors);

  job.set({
    status: 'queued', dryRun, mapping, options: { duplicate, matchField, dateFormat }, processed: 0, counts: { created: 0, updated: 0, skipped: 0, failed: 0 },
    errors: [], hasErrorsFile: false, failure: undefined, startedAt: undefined, finishedAt: undefined,
  });
  await job.save();
  // A resumed attempt continues from the saved checkpoint, so a few retries are safe.
  await enqueue('import.run', { importId: String(job._id) }, { maxAttempts: 3 });
  await audit(req, dryRun ? 'import.checked' : 'import.started', { type: 'import', id: job._id, summary: `${job.filename} → ${dataform.name}` });
  res.status(202).json({ import: present(job) });
});

router.post('/:id/cancel', validate({ params: idParams }), async (req, res) => {
  const { job } = await load(req, 'editor');
  if (!['queued', 'running'].includes(job.status)) throw conflict('This import is not running');
  job.status = 'cancelled';
  job.finishedAt = new Date();
  await job.save();
  res.json({ import: present(job) });
});

router.get('/:id/errors', validate({ params: idParams }), async (req, res) => {
  const { job } = await load(req, 'viewer', '+errorsKey');
  if (!job.errorsKey) throw notFound('This import has no errors file');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${path.parse(job.filename).name}-errors.csv"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = storage.stream(job.errorsKey);
  stream.on('error', () => (res.headersSent ? res.destroy() : res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The file is missing from storage' } })));
  stream.pipe(res);
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const { job } = await load(req, 'editor', '+storageKey +errorsKey');
  if (['queued', 'running'].includes(job.status)) throw conflict('Cancel the import before deleting it');
  await Promise.all([job.storageKey, job.errorsKey].filter(Boolean).map((k) => storage.remove(k).catch(() => {})));
  await job.deleteOne();
  res.status(204).end();
});

export default router;

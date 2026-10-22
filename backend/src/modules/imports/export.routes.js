import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, humansOnly } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import * as storage from '../../providers/storage.js';
import { conflict, notFound } from '../../utils/errors.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { enqueue } from '../queue/queue.js';
import { compileFilter, filterSchema } from '../records/filter.js';
import { loadFields } from '../records/record.service.js';
import { LEVEL, workspaceAccess } from '../workspaces/access.js';
import './export.service.js';
import { ExportJob } from './job.models.js';

const router = Router();
router.use(authenticate, humansOnly);
const idParams = z.object({ id: objectId });
const present = (j) => { const o = j.toObject ? j.toObject() : j; const { storageKey: _s, ...rest } = o; return rest; };

async function load(req, select = '') {
  const job = await ExportJob.findOne({ _id: req.params.id, account: req.auth.accountId }).select(select);
  if (!job) throw notFound('Export not found');
  const access = await workspaceAccess(req.auth, job.workspace);
  if (String(job.user) !== req.auth.userId && access.level < LEVEL.admin) throw notFound('Export not found');
  return job;
}

router.get('/', validate({ query: z.object({ dataformId: objectId }) }), async (req, res) => {
  const { dataform } = await loadDataform({ ...req, params: { id: req.query.dataformId } });
  const filter = { account: dataform.account, dataform: dataform._id, user: req.auth.userId };
  res.json({ data: (await ExportJob.find(filter).sort({ createdAt: -1 }).limit(25).lean()).map(present) });
});

router.post('/', validate({
  body: z.object({
    dataformId: objectId, format: z.enum(['csv', 'zip']).default('csv'),
    q: z.string().max(100).optional(), sort: z.string().max(60).optional(), filter: filterSchema.optional(), columns: z.array(z.string().max(60)).max(100).optional(),
  }),
}), async (req, res) => {
  const { dataformId, format, ...params } = req.body;
  const { dataform } = await loadDataform({ ...req, params: { id: dataformId } });
  compileFilter(params.filter, await loadFields(dataform._id)); // rejects a broken filter now, not minutes later in the background
  const pending = await ExportJob.countDocuments({ account: dataform.account, user: req.auth.userId, status: { $in: ['queued', 'running'] } });
  if (pending >= 3) throw conflict('You already have exports in progress. Wait for one to finish.');
  const job = await ExportJob.create({ account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, user: req.auth.userId, format, params });
  await enqueue('export.run', { exportId: String(job._id) }, { maxAttempts: 2 });
  res.status(202).json({ export: present(job) });
});

router.get('/:id', validate({ params: idParams }), async (req, res) => res.json({ export: present(await load(req)) }));

router.get('/:id/download', validate({ params: idParams }), async (req, res) => {
  const job = await load(req, '+storageKey');
  if (job.status !== 'done' || !job.storageKey) throw conflict('This export is not ready');
  res.setHeader('Content-Type', job.format === 'zip' ? 'application/zip' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(job.filename)}"`);
  res.setHeader('Content-Length', job.size);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = storage.stream(job.storageKey);
  stream.on('error', () => (res.headersSent ? res.destroy() : res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The file has expired' } })));
  stream.pipe(res);
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const job = await load(req, '+storageKey');
  if (['queued', 'running'].includes(job.status)) throw conflict('Wait for the export to finish');
  if (job.storageKey) await storage.remove(job.storageKey).catch(() => {});
  await job.deleteOne();
  res.status(204).end();
});

export default router;

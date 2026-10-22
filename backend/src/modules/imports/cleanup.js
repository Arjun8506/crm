import * as storage from '../../providers/storage.js';
import { EXPORT_KEEP_DAYS, ExportJob, IMPORT_KEEP_DAYS, ImportJob } from './job.models.js';

const DAY = 864e5;
const drop = (keys) => Promise.all(keys.filter(Boolean).map((k) => storage.remove(k).catch(() => {})));

// Uploaded import files and export results are temporary: removed (bytes and record) once they are old.
export async function purgeExpiredJobs(now = new Date()) {
  const oldImports = await ImportJob.find({ createdAt: { $lt: new Date(now - IMPORT_KEEP_DAYS * DAY) }, status: { $nin: ['queued', 'running'] } }).select('+storageKey +errorsKey').limit(200).lean();
  for (const j of oldImports) await drop([j.storageKey, j.errorsKey]);
  await ImportJob.deleteMany({ _id: { $in: oldImports.map((j) => j._id) } });
  const oldExports = await ExportJob.find({ createdAt: { $lt: new Date(now - EXPORT_KEEP_DAYS * DAY) }, status: { $nin: ['queued', 'running'] } }).select('+storageKey').limit(200).lean();
  await drop(oldExports.map((j) => j.storageKey));
  await ExportJob.deleteMany({ _id: { $in: oldExports.map((j) => j._id) } });
  return { imports: oldImports.length, exports: oldExports.length };
}

// Called when a dataform or workspace is deleted.
export async function purgeJobsFor(filter) {
  const [imports, exports] = await Promise.all([ImportJob.find(filter).select('+storageKey +errorsKey').lean(), ExportJob.find(filter).select('+storageKey').lean()]);
  await drop([...imports.flatMap((j) => [j.storageKey, j.errorsKey]), ...exports.map((j) => j.storageKey)]);
  await Promise.all([ImportJob.deleteMany(filter), ExportJob.deleteMany(filter)]);
}

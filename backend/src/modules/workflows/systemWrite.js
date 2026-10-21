import { emitWorkspace } from '../../sockets/index.js';
import { RecordHistory, RecordModel } from '../records/record.model.js';
import { buildData, checkReferences, diff } from '../records/record.service.js';
import { nextSource, triggerPostSave } from './trigger.js';

// Record writes performed by workflows. They validate types and references like any save, may set read-only fields,
// skip "before save" rules (a workflow must not be blocked by another), and trigger "after save" workflows one level deeper.

const announce = (dataform, recordId, action) => emitWorkspace(dataform.workspace, 'record.changed', { dataformId: String(dataform._id), recordId: String(recordId), action });

export async function systemCreate({ dataform, fields, data, actor, workflow, source }) {
  const clean = buildData(fields, data, 'create', { system: true });
  await checkReferences({ accountId: String(dataform.account) }, dataform, fields, clean);
  const record = await RecordModel.create({ account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, data: clean, createdBy: actor, updatedBy: actor });
  await RecordHistory.create({ account: dataform.account, dataform: dataform._id, record: record._id, action: 'create', user: actor, workflow: workflow._id, changes: diff({}, clean) });
  announce(dataform, record._id, 'create');
  await triggerPostSave({ dataform, fields, event: 'create', before: null, after: record.data, recordId: record._id, version: record.createdAt.getTime(), actorId: actor, source: nextSource(source, workflow) });
  return record;
}

// Returns false when nothing needed to change, so retries and repeated runs are harmless.
export async function systemUpdate({ dataform, fields, recordId, patch, actor, workflow, source }) {
  const record = await RecordModel.findOne({ _id: recordId, account: dataform.account, dataform: dataform._id });
  if (!record) throw new Error('The record no longer exists');
  const clean = buildData(fields, patch, 'update', { system: true });
  const changes = diff(record.data, clean);
  if (!changes.length) return false;
  await checkReferences({ accountId: String(dataform.account) }, dataform, fields, clean, { excludeId: record._id });
  const before = record.data;
  record.data = { ...record.data, ...clean };
  record.markModified('data');
  record.updatedBy = actor;
  await record.save();
  await RecordHistory.create({ account: dataform.account, dataform: dataform._id, record: record._id, action: 'update', user: actor, workflow: workflow._id, changes });
  announce(dataform, record._id, 'update');
  await triggerPostSave({ dataform, fields, event: 'update', before, after: record.data, recordId: record._id, version: record.updatedAt.getTime(), actorId: actor, source: nextSource(source, workflow) });
  return true;
}

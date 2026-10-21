import * as storage from '../../providers/storage.js';
import { Attachment } from '../attachments/attachment.model.js';
import { Comment, Follow } from '../comments/comment.model.js';
import { Task } from '../tasks/task.model.js';
import { Dataform, FieldDefinition } from '../dataforms/dataform.model.js';
import { Report } from '../analytics/report.model.js';
import { View } from '../views/view.model.js';
import { RecordHistory, RecordModel } from './record.model.js';

// Removes everything that hangs off records when they are deleted: discussion, follows, files (bytes included).
// Tasks survive (they may involve other work) but lose their link to the deleted record.
async function purge(filterFor) {
  const files = await Attachment.find(filterFor.attachment).select('+storageKey').lean();
  await Promise.all(files.map((f) => storage.remove(f.storageKey).catch(() => {})));
  await Promise.all([
    Attachment.deleteMany(filterFor.attachment),
    Comment.deleteMany(filterFor.comment),
    Follow.deleteMany(filterFor.follow),
    Task.updateMany(filterFor.task, { $unset: { record: '', dataform: '' } }),
  ]);
}

export const purgeRecords = (accountId, recordIds) => purge({
  attachment: { account: accountId, record: { $in: recordIds } },
  comment: { account: accountId, record: { $in: recordIds } },
  follow: { account: accountId, record: { $in: recordIds } },
  task: { account: accountId, record: { $in: recordIds } },
});

export const purgeDataformArtifacts = (accountId, dataformId) => purge({
  attachment: { account: accountId, dataform: dataformId },
  comment: { account: accountId, dataform: dataformId },
  follow: { account: accountId, dataform: dataformId },
  task: { account: accountId, dataform: dataformId },
});

// Deleting a workspace removes everything inside it, including uploaded file bytes.
export async function purgeWorkspace(accountId, workspaceId) {
  const forms = await Dataform.find({ account: accountId, workspace: workspaceId }).select('_id').lean();
  const formIds = forms.map((f) => f._id);
  const files = await Attachment.find({ account: accountId, workspace: workspaceId }).select('+storageKey').lean();
  await Promise.all(files.map((f) => storage.remove(f.storageKey).catch(() => {})));
  await Promise.all([
    Attachment.deleteMany({ account: accountId, workspace: workspaceId }),
    Comment.deleteMany({ account: accountId, workspace: workspaceId }),
    Follow.deleteMany({ account: accountId, workspace: workspaceId }),
    Task.deleteMany({ account: accountId, workspace: workspaceId }),
    RecordModel.deleteMany({ account: accountId, workspace: workspaceId }),
    RecordHistory.deleteMany({ account: accountId, dataform: { $in: formIds } }),
    FieldDefinition.deleteMany({ dataform: { $in: formIds } }),
    View.deleteMany({ account: accountId, dataform: { $in: formIds } }),
    Report.deleteMany({ account: accountId, workspace: workspaceId }),
    Dataform.deleteMany({ account: accountId, workspace: workspaceId }),
  ]);
}

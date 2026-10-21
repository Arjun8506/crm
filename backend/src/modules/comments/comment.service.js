import { notFound } from '../../utils/errors.js';
import { RecordModel } from '../records/record.model.js';
import { label } from '../records/record.service.js';
import { usersWithAccess } from '../workspaces/access.js';
import { Comment, Follow } from './comment.model.js';

export const excerpt = (s, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function autoFollow({ workspace, dataform, record, userIds }) {
  const ops = [...new Set(userIds.map(String))].map((user) => ({
    updateOne: {
      filter: { user, record },
      update: { $setOnInsert: { account: workspace.account, workspace: workspace._id, dataform, record, user, reason: 'auto' } },
      upsert: true,
    },
  }));
  if (ops.length) await Follow.bulkWrite(ops);
}

export async function followersOf(record) {
  const rows = await Follow.find({ record }).select('user').lean();
  return rows.map((r) => String(r.user));
}

// Keeps only mentions of people who can actually open the workspace, so a comment can never reveal a record to someone without access.
export const validMentions = (workspace, ids) => usersWithAccess(workspace, ids ?? []);

export async function threadFor(filter, viewerId) {
  const rows = await Comment.find(filter).sort({ createdAt: 1 }).limit(500).populate('author', 'name').populate('mentions', 'name').lean();
  const mark = (c) => ({ ...c, mine: String(c.author?._id) === String(viewerId) });
  const top = rows.filter((c) => !c.parent).map(mark);
  const byParent = new Map();
  for (const c of rows.filter((x) => x.parent)) byParent.set(String(c.parent), [...(byParent.get(String(c.parent)) ?? []), mark(c)]);
  return top.map((c) => ({ ...c, replies: byParent.get(String(c._id)) ?? [] }));
}

export async function recordLabel(dataform, recordId) {
  const record = await RecordModel.findOne({ _id: recordId, account: dataform.account, dataform: dataform._id }).lean();
  if (!record) throw notFound('Record not found');
  return { record, name: label(dataform, record) };
}

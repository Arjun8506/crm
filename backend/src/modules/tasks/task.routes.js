import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { emitWorkspace } from '../../sockets/index.js';
import { Comment } from '../comments/comment.model.js';
import { excerpt, threadFor, validMentions } from '../comments/comment.service.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { notify } from '../notifications/notification.service.js';
import { dispatchEvent } from '../outbound/events.js';
import { RecordModel } from '../records/record.model.js';
import { label } from '../records/record.service.js';
import { LEVEL, accessibleWorkspaceIds, usersWithAccess, workspaceAccess } from '../workspaces/access.js';
import { Task, TaskActivity } from './task.model.js';

const router = Router();
router.use(authenticate);

const idParams = z.object({ id: objectId });
const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  assignees: z.array(objectId).max(10),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  status: z.enum(['todo', 'in_progress', 'done']),
  due: isoDate.nullable(),
  reminderAt: isoDate.nullable(),
};
const createBody = z.object({
  workspaceId: objectId, recordId: objectId.optional(),
  title: fields.title, description: fields.description.default(''), assignees: fields.assignees.default([]),
  priority: fields.priority.default('normal'), status: fields.status.default('todo'), due: fields.due.default(null), reminderAt: fields.reminderAt.default(null),
});
const updateBody = z.object({ title: fields.title, description: fields.description, assignees: fields.assignees, priority: fields.priority, status: fields.status, due: fields.due, reminderAt: fields.reminderAt }).partial();

const link = (t) => `/tasks?task=${t._id}`;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function present(auth, tasks) {
  const recordIds = tasks.map((t) => t.record).filter(Boolean);
  const records = recordIds.length ? await RecordModel.find({ _id: { $in: recordIds }, account: auth.accountId }).lean() : [];
  const forms = records.length ? await Dataform.find({ _id: { $in: [...new Set(records.map((r) => r.dataform))] } }).lean() : [];
  const formMap = new Map(forms.map((f) => [String(f._id), f]));
  const recMap = new Map(records.map((r) => [String(r._id), { id: String(r._id), dataformId: String(r.dataform), label: label(formMap.get(String(r.dataform)) ?? {}, r) }]));
  return tasks.map((t) => ({ ...t, recordRef: t.record ? recMap.get(String(t.record)) ?? null : null }));
}

async function loadTask(req, minLevel = 'viewer') {
  const task = await Task.findOne({ _id: req.params.id, account: req.auth.accountId });
  if (!task) throw notFound('Task not found');
  const access = await workspaceAccess(req.auth, task.workspace, minLevel);
  return { task, access };
}

const emit = (task) => emitWorkspace(task.workspace, 'task.changed', { taskId: String(task._id) });
const taskPayload = (t) => ({ task: { id: String(t._id), title: t.title, status: t.status, priority: t.priority, due: t.due ?? null, assignees: t.assignees.map(String), workspaceId: String(t.workspace), recordId: t.record ? String(t.record) : null } });
const taskEvent = (t, event) => dispatchEvent({ account: t.account, event, dataformId: t.dataform, data: taskPayload(t) });

router.get(
  '/',
  validate({
    query: z.object({
      scope: z.enum(['mine', 'workspace']).default('mine'), workspaceId: objectId.optional(), recordId: objectId.optional(),
      status: z.enum(['open', 'done', 'all']).default('open'), dueFrom: z.string().datetime({ offset: true }).optional(), dueTo: z.string().datetime({ offset: true }).optional(),
      noDue: z.enum(['true']).optional(), q: z.string().max(100).optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  }),
  async (req, res) => {
    const { scope, workspaceId, recordId, status, dueFrom, dueTo, noDue, q, page, limit } = req.query;
    const filter = { account: req.auth.accountId };
    if (scope === 'workspace') {
      if (!workspaceId) throw badRequest('workspaceId is required for the workspace scope');
      filter.workspace = (await workspaceAccess(req.auth, workspaceId)).workspace._id;
    } else {
      filter.assignees = req.auth.userId;
      filter.workspace = { $in: await accessibleWorkspaceIds(req.auth) };
    }
    if (recordId) filter.record = recordId;
    if (status === 'open') filter.status = { $ne: 'done' };
    if (status === 'done') filter.status = 'done';
    if (noDue) filter.due = null;
    else if (dueFrom || dueTo) filter.due = { ...(dueFrom ? { $gte: new Date(dueFrom) } : {}), ...(dueTo ? { $lt: new Date(dueTo) } : {}) };
    if (q) filter.title = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    const [rows, total] = await Promise.all([
      Task.find(filter).sort(status === 'done' ? { completedAt: -1, _id: 1 } : { dueSort: 1, createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit)
        .populate('assignees', 'name').populate('createdBy', 'name').lean(),
      Task.countDocuments(filter),
    ]);
    res.json({ data: await present(req.auth, rows), total, page, limit });
  },
);

router.post('/', validate({ body: createBody }), async (req, res) => {
  const { workspace } = await workspaceAccess(req.auth, req.body.workspaceId, 'editor');
  let dataform;
  if (req.body.recordId) {
    const record = await RecordModel.findOne({ _id: req.body.recordId, account: req.auth.accountId, workspace: workspace._id }).lean();
    if (!record) throw notFound('Record not found');
    dataform = record.dataform;
  }
  const assignees = [...new Set(req.body.assignees)];
  const allowed = await usersWithAccess(workspace, assignees);
  if (allowed.length !== assignees.length) throw badRequest('Every assignee must be a member who can open this workspace');

  const task = await Task.create({
    account: req.auth.accountId, workspace: workspace._id, dataform, record: req.body.recordId, createdBy: req.auth.userId,
    title: req.body.title, description: req.body.description, assignees, priority: req.body.priority, status: req.body.status,
    due: req.body.due ?? undefined, reminderAt: req.body.reminderAt ?? undefined, completedAt: req.body.status === 'done' ? new Date() : undefined,
  });
  await TaskActivity.create({ account: task.account, task: task._id, user: req.auth.userId, action: 'create' });
  await notify({ account: task.account, recipients: assignees, actor: req.auth.userId, type: 'task_assigned', title: `You were assigned: ${task.title}`, body: task.due ? `Due ${task.due.toISOString().slice(0, 10)}` : '', link: link(task) });
  emit(task);
  await taskEvent(task, 'task.created');
  res.status(201).json({ task });
});

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  const { task, access } = await loadTask(req);
  const [full] = await present(req.auth, [(await task.populate([{ path: 'assignees', select: 'name' }, { path: 'createdBy', select: 'name' }])).toObject()]);
  const activity = await TaskActivity.find({ task: task._id }).sort({ at: -1 }).limit(50).populate('user', 'name').lean();
  res.json({ task: full, activity, access: access.levelName, canEdit: String(task.createdBy._id ?? task.createdBy) === req.auth.userId || access.level >= LEVEL.admin });
});

router.patch('/:id', validate({ params: idParams, body: updateBody }), async (req, res) => {
  const { task, access } = await loadTask(req);
  const isOwner = String(task.createdBy) === req.auth.userId || access.level >= LEVEL.admin;
  const isAssignee = task.assignees.some((a) => String(a) === req.auth.userId);
  if (!isOwner && !(isAssignee && access.level >= LEVEL.editor)) throw forbidden();
  // Assignees can move their own task along; everything else belongs to the creator or a workspace admin.
  const allowedKeys = isOwner ? Object.keys(req.body) : Object.keys(req.body).filter((k) => ['status', 'reminderAt'].includes(k));
  if (!isOwner && allowedKeys.length !== Object.keys(req.body).length) throw forbidden('Assignees can only change the status and reminder');

  if (req.body.assignees) {
    const unique = [...new Set(req.body.assignees)];
    if ((await usersWithAccess(access.workspace, unique)).length !== unique.length) throw badRequest('Every assignee must be a member who can open this workspace');
    req.body.assignees = unique;
  }
  const changes = [];
  const before = task.toObject();
  for (const k of allowedKeys) {
    const next = req.body[k] ?? undefined;
    const prev = before[k];
    if (same(prev, next)) continue;
    changes.push({ field: k, from: prev ?? null, to: next ?? null });
    task[k] = next;
  }
  if (changes.some((c) => c.field === 'status')) task.completedAt = task.status === 'done' ? new Date() : undefined;
  if (changes.some((c) => c.field === 'reminderAt')) task.reminderSentAt = undefined;
  if (changes.some((c) => c.field === 'due')) { task.dueSoonNotifiedAt = undefined; task.overdueNotifiedAt = undefined; }
  if (changes.length) {
    await task.save();
    await TaskActivity.create({ account: task.account, task: task._id, user: req.auth.userId, action: 'update', changes });
    const added = req.body.assignees ? req.body.assignees.filter((a) => !before.assignees.some((b) => String(b) === a)) : [];
    await notify({ account: task.account, recipients: added, actor: req.auth.userId, type: 'task_assigned', title: `You were assigned: ${task.title}`, link: link(task) });
    emit(task);
    await taskEvent(task, 'task.updated');
  }
  res.json({ task });
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const { task, access } = await loadTask(req);
  if (String(task.createdBy) !== req.auth.userId && access.level < LEVEL.admin) throw forbidden('Only the creator or a workspace admin can delete this task');
  await Promise.all([task.deleteOne(), TaskActivity.deleteMany({ task: task._id }), Comment.deleteMany({ task: task._id })]);
  emit(task);
  await taskEvent(task, 'task.deleted');
  res.status(204).end();
});

// ---- task comments ----
const commentBody = z.object({ body: z.string().trim().min(1).max(5000), mentions: z.array(objectId).max(20).default([]) });

router.get('/:id/comments', validate({ params: idParams }), async (req, res) => {
  const { task } = await loadTask(req);
  res.json({ data: await threadFor({ account: task.account, task: task._id }, req.auth.userId) });
});

router.post('/:id/comments', validate({ params: idParams, body: commentBody }), async (req, res) => {
  const { task, access } = await loadTask(req, 'editor');
  const mentions = (await validMentions(access.workspace, req.body.mentions)).filter((m) => m !== req.auth.userId);
  const comment = await Comment.create({ account: task.account, workspace: task.workspace, task: task._id, author: req.auth.userId, body: req.body.body, mentions });
  const author = (await comment.populate('author', 'name')).author.name;
  await notify({ account: task.account, recipients: mentions, actor: req.auth.userId, type: 'mention', title: `${author} mentioned you on task “${task.title}”`, body: excerpt(req.body.body), link: link(task) });
  await notify({
    account: task.account, recipients: [...task.assignees, task.createdBy].filter((id) => !mentions.includes(String(id))), actor: req.auth.userId, type: 'task_comment',
    title: `${author} commented on “${task.title}”`, body: excerpt(req.body.body), link: link(task),
  });
  emitWorkspace(task.workspace, 'comment.changed', { taskId: String(task._id) });
  res.status(201).json({ comment });
});

export default router;

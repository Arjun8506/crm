import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { emitWorkspace } from '../../sockets/index.js';
import { Dataform } from '../dataforms/dataform.model.js';
import { loadDataform } from '../dataforms/dataform.service.js';
import { notify } from '../notifications/notification.service.js';
import { LEVEL, workspaceAccess } from '../workspaces/access.js';
import { Comment, Follow } from './comment.model.js';
import { autoFollow, excerpt, followersOf, recordLabel, threadFor, validMentions } from './comment.service.js';

const dir = (r) => `/w/${r.workspace}/f/${r.dataform}?record=${r.record}`;

// ---- record comments: mounted at /dataforms/:id/records/:recordId ----
export const recordCommentRouter = Router({ mergeParams: true });
recordCommentRouter.use(authenticate);
const recordParams = z.object({ id: objectId, recordId: objectId });
const commentBody = z.object({ body: z.string().trim().min(1).max(5000), mentions: z.array(objectId).max(20).default([]), parent: objectId.optional() });

recordCommentRouter.get('/comments', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  await recordLabel(dataform, req.params.recordId);
  const [data, followers] = await Promise.all([
    threadFor({ account: dataform.account, record: req.params.recordId }, req.auth.userId),
    followersOf(req.params.recordId),
  ]);
  res.json({ data, following: followers.includes(req.auth.userId), followers: followers.length });
});

recordCommentRouter.post('/comments', validate({ params: recordParams, body: commentBody }), async (req, res) => {
  const { dataform, access } = await loadDataform(req, 'editor');
  const { name } = await recordLabel(dataform, req.params.recordId);
  if (req.body.parent) {
    const parent = await Comment.findOne({ _id: req.body.parent, account: dataform.account, record: req.params.recordId });
    if (!parent) throw notFound('The comment you are replying to no longer exists');
    if (parent.parent) throw badRequest('Replies can only be one level deep');
  }
  const mentions = (await validMentions(access.workspace, req.body.mentions)).filter((id) => id !== req.auth.userId);
  const comment = await Comment.create({
    account: dataform.account, workspace: dataform.workspace, dataform: dataform._id, record: req.params.recordId,
    author: req.auth.userId, parent: req.body.parent ?? null, body: req.body.body, mentions,
  });
  await autoFollow({ workspace: access.workspace, dataform: dataform._id, record: req.params.recordId, userIds: [req.auth.userId, ...mentions] });

  const link = dir({ workspace: dataform.workspace, dataform: dataform._id, record: req.params.recordId });
  const followers = await followersOf(req.params.recordId);
  const author = (await comment.populate('author', 'name')).author.name;
  await notify({ account: dataform.account, recipients: mentions, actor: req.auth.userId, type: 'mention', title: `${author} mentioned you on ${name}`, body: excerpt(req.body.body), link });
  await notify({
    account: dataform.account, recipients: followers.filter((f) => !mentions.includes(f)), actor: req.auth.userId, type: 'comment',
    title: `${author} commented on ${name}`, body: excerpt(req.body.body), link,
  });
  emitWorkspace(dataform.workspace, 'comment.changed', { dataformId: String(dataform._id), recordId: req.params.recordId });
  res.status(201).json({ comment });
});

recordCommentRouter.put('/follow', validate({ params: recordParams }), async (req, res) => {
  const { dataform, access } = await loadDataform(req);
  await recordLabel(dataform, req.params.recordId);
  await Follow.updateOne({ user: req.auth.userId, record: req.params.recordId }, { $setOnInsert: { account: dataform.account, workspace: access.workspace._id, dataform: dataform._id, reason: 'manual' } }, { upsert: true });
  res.json({ following: true });
});

recordCommentRouter.delete('/follow', validate({ params: recordParams }), async (req, res) => {
  const { dataform } = await loadDataform(req);
  await Follow.deleteOne({ user: req.auth.userId, record: req.params.recordId, account: dataform.account });
  res.json({ following: false });
});

// ---- single-comment actions: mounted at /comments ----
const router = Router();
router.use(authenticate);
const idParams = z.object({ id: objectId });

async function loadComment(req) {
  const comment = await Comment.findOne({ _id: req.params.id, account: req.auth.accountId });
  if (!comment) throw notFound('Comment not found');
  const access = await workspaceAccess(req.auth, comment.workspace); // 404 when the workspace is not visible to the caller
  return { comment, access };
}

router.patch('/:id', validate({ params: idParams, body: commentBody.omit({ parent: true }) }), async (req, res) => {
  const { comment, access } = await loadComment(req);
  if (String(comment.author) !== req.auth.userId) throw forbidden('You can only edit your own comments');
  const before = new Set(comment.mentions.map(String));
  const mentions = (await validMentions(access.workspace, req.body.mentions)).filter((id) => id !== req.auth.userId);
  comment.body = req.body.body;
  comment.mentions = mentions;
  comment.editedAt = new Date();
  await comment.save();
  const fresh = mentions.filter((id) => !before.has(id));
  if (fresh.length && comment.record) {
    const dataform = await Dataform.findById(comment.dataform);
    const { name } = await recordLabel(dataform, comment.record);
    await autoFollow({ workspace: access.workspace, dataform: dataform._id, record: comment.record, userIds: fresh });
    await notify({ account: comment.account, recipients: fresh, actor: req.auth.userId, type: 'mention', title: `You were mentioned on ${name}`, body: excerpt(comment.body), link: dir({ workspace: comment.workspace, dataform: comment.dataform, record: comment.record }) });
  }
  emitWorkspace(comment.workspace, 'comment.changed', { dataformId: String(comment.dataform ?? ''), recordId: String(comment.record ?? ''), taskId: String(comment.task ?? '') });
  res.json({ comment });
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const { comment, access } = await loadComment(req);
  if (String(comment.author) !== req.auth.userId && access.level < LEVEL.admin) throw forbidden('Only the author or a workspace admin can delete this comment');
  await Comment.deleteMany({ $or: [{ _id: comment._id }, { parent: comment._id }] });
  emitWorkspace(comment.workspace, 'comment.changed', { dataformId: String(comment.dataform ?? ''), recordId: String(comment.record ?? ''), taskId: String(comment.task ?? '') });
  res.status(204).end();
});

export default router;

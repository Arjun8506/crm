import { useMemo, useState } from 'react';
import { Avatar, Box, Button, Divider, List, ListItemButton, ListItemText, Paper, Popper, Skeleton, Stack, TextField, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ConfirmDialog, EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useListMembersQuery } from '../accounts/accountApi';
import { showToast } from '../ui/uiSlice';
import {
  useAddRecordCommentMutation, useAddTaskCommentMutation, useDeleteCommentMutation, useEditCommentMutation,
  useListRecordCommentsQuery, useListTaskCommentsQuery,
} from './collabApi';

dayjs.extend(relativeTime);

// Textarea with @-mention autocomplete. Mentions are returned as user ids; the server re-checks access to each one.
function Composer({ initial = '', initialMentions = [], placeholder, submitLabel, busy, onSubmit, onCancel, autoFocus }) {
  const { data: members = [] } = useListMembersQuery();
  const [text, setText] = useState(initial);
  const [picked, setPicked] = useState(() => initialMentions);
  const [query, setQuery] = useState(null); // text typed after the active "@"
  const [anchorEl, setAnchorEl] = useState(null);
  const people = useMemo(() => members.filter((m) => m.status === 'active').map((m) => m.user), [members]);
  const matches = query === null ? [] : people.filter((u) => u.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const change = (e) => {
    const value = e.target.value;
    setText(value);
    const upto = value.slice(0, e.target.selectionStart);
    const m = /(?:^|\s)@([\w ]{0,30})$/.exec(upto);
    setQuery(m ? m[1] : null);
  };
  const choose = (user) => {
    const el = anchorEl.querySelector('textarea');
    const pos = el.selectionStart;
    const before = text.slice(0, pos).replace(/@[\w ]{0,30}$/, `@${user.name} `);
    setText(before + text.slice(pos));
    setPicked((p) => (p.some((x) => x._id === user._id) ? p : [...p, user]));
    setQuery(null);
    requestAnimationFrame(() => el.focus());
  };
  // Only mentions whose "@Name" is still in the text count.
  const mentions = picked.filter((u) => text.includes(`@${u.name}`)).map((u) => u._id);
  const submit = async () => { if (await onSubmit({ body: text.trim(), mentions })) { setText(''); setPicked([]); } };

  return (
    <Box ref={setAnchorEl}>
      <TextField
        multiline minRows={2} fullWidth value={text} onChange={change} placeholder={placeholder} autoFocus={autoFocus}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) submit(); if (e.key === 'Escape') setQuery(null); }}
        slotProps={{ htmlInput: { 'aria-label': placeholder } }}
      />
      <Popper open={matches.length > 0} anchorEl={anchorEl} placement="bottom-start" sx={{ zIndex: 1500 }}>
        <Paper elevation={6} sx={{ width: 260 }}>
          <List dense role="listbox" aria-label="Mention suggestions">
            {matches.map((u) => (
              <ListItemButton key={u._id} role="option" onMouseDown={(e) => { e.preventDefault(); choose(u); }}>
                <ListItemText primary={u.name} secondary={u.email} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      </Popper>
      <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">Type @ to mention someone · Ctrl+Enter to send</Typography>
        <Stack direction="row" spacing={1}>
          {onCancel && <Button size="small" color="inherit" onClick={onCancel}>Cancel</Button>}
          <Button size="small" variant="contained" disabled={!text.trim() || busy} onClick={submit}>{submitLabel}</Button>
        </Stack>
      </Stack>
    </Box>
  );
}

// "@Name" tokens belonging to real mentions are highlighted; everything else is plain text.
function Body({ comment }) {
  const names = (comment.mentions ?? []).map((m) => `@${m.name}`);
  if (names.length === 0) return <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{comment.body}</Typography>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const parts = comment.body.split(new RegExp(`(${escaped})`, 'g'));
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((p, i) => (names.includes(p) ? <Box key={i} component="span" sx={{ color: 'primary.main', fontWeight: 600 }}>{p}</Box> : p))}
    </Typography>
  );
}

function Comment({ c, canReply, canWrite, canModerate, onReply, onSaved }) {
  const dispatch = useDispatch();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [edit, editState] = useEditCommentMutation();
  const [remove] = useDeleteCommentMutation();
  const run = async (fn, ok) => { try { await fn().unwrap(); if (ok) dispatch(showToast(ok)); onSaved?.(); return true; } catch (err) { dispatch(showToast(errorMessage(err), 'error')); return false; } };

  return (
    <Stack direction="row" spacing={1.5}>
      <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>{c.author?.name?.[0]}</Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="body2" fontWeight={600}>{c.author?.name ?? 'Unknown'}</Typography>
          <Typography variant="caption" color="text.secondary" title={dayjs(c.createdAt).format('MMM D, YYYY h:mm A')}>{dayjs(c.createdAt).fromNow()}{c.editedAt ? ' · edited' : ''}</Typography>
        </Stack>
        {editing ? (
          <Box sx={{ mt: 0.5 }}>
            <Composer
              autoFocus initial={c.body} initialMentions={c.mentions} placeholder="Edit comment" submitLabel="Save" busy={editState.isLoading} onCancel={() => setEditing(false)}
              onSubmit={async (v) => { const ok = await run(() => edit({ id: c._id, ...v }), 'Comment updated'); if (ok) setEditing(false); return ok; }}
            />
          </Box>
        ) : <Body comment={c} />}
        {!editing && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.25 }}>
            {canReply && canWrite && <Button size="small" sx={{ minWidth: 0 }} onClick={onReply}>Reply</Button>}
            {c.mine && canWrite && <Button size="small" color="inherit" sx={{ minWidth: 0 }} onClick={() => setEditing(true)}>Edit</Button>}
            {(c.mine || canModerate) && canWrite && <Button size="small" color="inherit" sx={{ minWidth: 0 }} onClick={() => setConfirming(true)}>Delete</Button>}
          </Stack>
        )}
      </Box>
      <ConfirmDialog
        open={confirming} destructive title="Delete this comment?" confirmLabel="Delete" message="Replies to it are deleted too."
        onClose={() => setConfirming(false)} onConfirm={async () => { await run(() => remove(c._id), 'Comment deleted'); setConfirming(false); }}
      />
    </Stack>
  );
}

export default function CommentsPanel({ kind, dataformId, recordId, taskId, canWrite, canModerate }) {
  const dispatch = useDispatch();
  const rec = kind === 'record';
  const recQ = useListRecordCommentsQuery({ dataformId, recordId }, { skip: !rec });
  const taskQ = useListTaskCommentsQuery(taskId, { skip: rec });
  const { data, isLoading, error, refetch } = rec ? recQ : taskQ;
  const threads = data?.data ?? [];
  const [addRecord, recState] = useAddRecordCommentMutation();
  const [addTask, taskState] = useAddTaskCommentMutation();
  const [replyTo, setReplyTo] = useState(null);

  const post = async (v, parent) => {
    try {
      if (rec) await addRecord({ dataformId, recordId, ...v, ...(parent ? { parent } : {}) }).unwrap();
      else await addTask({ id: taskId, ...v }).unwrap();
      setReplyTo(null);
      return true;
    } catch (err) {
      dispatch(showToast(errorMessage(err, 'Could not post the comment'), 'error'));
      return false;
    }
  };

  if (error) return <ErrorState message={errorMessage(error, 'Could not load comments')} onRetry={refetch} />;
  return (
    <Stack spacing={2.5}>
      {canWrite && <Composer placeholder="Write a comment…" submitLabel="Comment" busy={recState.isLoading || taskState.isLoading} onSubmit={(v) => post(v)} />}
      <Divider />
      {isLoading ? <Skeleton variant="rounded" height={120} />
        : threads.length === 0 ? <EmptyState title="No comments yet" description={canWrite ? 'Start the discussion, and @mention a teammate to notify them.' : undefined} />
          : threads.map((t) => (
            <Stack key={t._id} spacing={1.5}>
              <Comment c={t} canWrite={canWrite} canModerate={canModerate} canReply={rec} onReply={() => setReplyTo(t._id)} />
              {t.replies.length > 0 && (
                <Stack spacing={1.5} sx={{ ml: 5.5, pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                  {t.replies.map((r) => <Comment key={r._id} c={r} canWrite={canWrite} canModerate={canModerate} canReply={false} />)}
                </Stack>
              )}
              {replyTo === t._id && (
                <Box sx={{ ml: 5.5 }}>
                  <Composer autoFocus placeholder={`Reply to ${t.author?.name ?? 'comment'}`} submitLabel="Reply" busy={recState.isLoading} onCancel={() => setReplyTo(null)} onSubmit={(v) => post(v, t._id)} />
                </Box>
              )}
            </Stack>
          ))}
    </Stack>
  );
}

import { useState } from 'react';
import { Avatar, AvatarGroup, Box, Button, Chip, Divider, Drawer, IconButton, MenuItem, Skeleton, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { Link as RouterLink } from 'react-router-dom';
import dayjs from 'dayjs';
import CloseIcon from '@mui/icons-material/CloseRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditIcon from '@mui/icons-material/EditOutlined';
import { ConfirmDialog, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import CommentsPanel from '../collab/CommentsPanel';
import { useDeleteTaskMutation, useGetTaskQuery, useUpdateTaskMutation } from '../collab/collabApi';
import { showToast } from '../ui/uiSlice';
import TaskDialog from './TaskDialog';

export const PRIORITY_COLOR = { low: 'default', normal: 'info', high: 'warning', urgent: 'error' };
export const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

function Activity({ items }) {
  if (!items.length) return <Typography color="text.secondary">No activity yet.</Typography>;
  const show = (v) => (v === null || v === undefined || v === '' ? 'empty' : Array.isArray(v) ? `${v.length} people` : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? dayjs(v).format('MMM D, h:mm A') : String(v));
  return (
    <Stack spacing={1.5} divider={<Divider />}>
      {items.map((a) => (
        <Box key={a._id}>
          <Typography variant="body2" fontWeight={600}>{a.user?.name ?? 'Someone'} {a.action === 'create' ? 'created this task' : 'updated this task'}</Typography>
          <Typography variant="caption" color="text.secondary">{dayjs(a.at).format('MMM D, YYYY h:mm A')}</Typography>
          {a.changes.map((c) => <Typography key={c.field} variant="body2" sx={{ mt: 0.25 }}><b>{c.field === 'reminderAt' ? 'reminder' : c.field}</b>: <span style={{ opacity: 0.7 }}>{show(c.from)}</span> → {show(c.to)}</Typography>)}
        </Box>
      ))}
    </Stack>
  );
}

export default function TaskDrawer({ taskId, onClose }) {
  const dispatch = useDispatch();
  const { data, isLoading, error, refetch } = useGetTaskQuery(taskId);
  const [update] = useUpdateTaskMutation();
  const [remove, removeState] = useDeleteTaskMutation();
  const [tab, setTab] = useState('comments');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const task = data?.task;
  const [now] = useState(() => Date.now());

  const setStatus = async (status) => {
    try { await update({ id: taskId, status }).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err, 'Could not change the status'), 'error')); }
  };

  return (
    <Drawer anchor="right" open onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, display: 'flex' } } }}>
      <Stack direction="row" spacing={1} sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}>
        <Typography variant="h6" noWrap sx={{ flex: 1 }}>{task?.title ?? 'Task'}</Typography>
        {data?.canEdit && <Tooltip title="Edit"><IconButton aria-label="Edit task" onClick={() => setEditing(true)}><EditIcon /></IconButton></Tooltip>}
        {data?.canEdit && <Tooltip title="Delete"><IconButton aria-label="Delete task" color="error" onClick={() => setConfirm(true)}><DeleteIcon /></IconButton></Tooltip>}
        <IconButton aria-label="Close" onClick={onClose}><CloseIcon /></IconButton>
      </Stack>
      {error ? <Box sx={{ p: 3 }}><ErrorState message={errorMessage(error, 'Could not load the task')} onRetry={refetch} /></Box>
        : isLoading || !task ? <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={200} /></Box> : (
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            <Stack spacing={2} sx={{ p: 3 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <TextField select size="small" label="Status" value={task.status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 150 }} disabled={data.access === 'viewer'}>
                  {Object.entries(STATUS_LABEL).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
                </TextField>
                <Chip size="small" color={PRIORITY_COLOR[task.priority]} label={`${task.priority} priority`} />
                {task.due && <Chip size="small" variant="outlined" color={task.status !== 'done' && new Date(task.due).getTime() < now ? 'error' : 'default'} label={`Due ${dayjs(task.due).format('MMM D, h:mm A')}`} />}
                {task.reminderAt && <Chip size="small" variant="outlined" label={`Reminder ${dayjs(task.reminderAt).format('MMM D, h:mm A')}`} />}
              </Stack>
              {task.description && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{task.description}</Typography>}
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">Assigned to</Typography>
                {task.assignees.length ? (
                  <AvatarGroup max={5}>{task.assignees.map((a) => <Tooltip key={a._id} title={a.name}><Avatar sx={{ bgcolor: 'primary.main' }}>{a.name[0]}</Avatar></Tooltip>)}</AvatarGroup>
                ) : <Typography variant="body2">Nobody yet</Typography>}
              </Stack>
              {task.recordRef && (
                <Typography variant="body2" color="text.secondary">
                  About: <Button size="small" component={RouterLink} to={`/w/${task.workspace}/f/${task.recordRef.dataformId}?record=${task.recordRef.id}`} onClick={onClose}>{task.recordRef.label}</Button>
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">Created by {task.createdBy?.name} on {dayjs(task.createdAt).format('MMM D, YYYY')}</Typography>
            </Stack>
            <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ px: 2, borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Tab value="comments" label="Comments" /><Tab value="activity" label="Activity" />
            </Tabs>
            <Box sx={{ p: 3 }}>
              {tab === 'comments' ? <CommentsPanel kind="task" taskId={taskId} canWrite={data.access !== 'viewer'} canModerate={data.access === 'admin'} /> : <Activity items={data.activity} />}
            </Box>
          </Box>
        )}
      {editing && task && <TaskDialog task={task} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={confirm} destructive loading={removeState.isLoading} title="Delete this task?" confirmLabel="Delete task" message="The task and its comments are permanently removed."
        onClose={() => setConfirm(false)}
        onConfirm={async () => { try { await remove(taskId).unwrap(); dispatch(showToast('Task deleted')); onClose(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } setConfirm(false); }}
      />
    </Drawer>
  );
}

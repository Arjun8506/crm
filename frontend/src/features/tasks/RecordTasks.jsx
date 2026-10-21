import { useState } from 'react';
import { Box, Button, Checkbox, Chip, Skeleton, Stack, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import AddIcon from '@mui/icons-material/AddRounded';
import TaskIcon from '@mui/icons-material/TaskAltRounded';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useListTasksQuery, useUpdateTaskMutation } from '../collab/collabApi';
import { showToast } from '../ui/uiSlice';
import TaskDialog from './TaskDialog';
import TaskDrawer, { PRIORITY_COLOR } from './TaskDrawer';

// Tasks linked to one record, shown inside the record drawer.
export default function RecordTasks({ workspaceId, recordId, recordLabel, canWrite }) {
  const dispatch = useDispatch();
  const { data, isLoading, error, refetch } = useListTasksQuery({ scope: 'workspace', workspaceId, recordId, status: 'all', limit: 50 });
  const [update] = useUpdateTaskMutation();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [now] = useState(() => Date.now());
  const tasks = data?.data ?? [];

  const toggle = async (t) => {
    try { await update({ id: t._id, status: t.status === 'done' ? 'todo' : 'done' }).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };

  if (error) return <ErrorState message={errorMessage(error, 'Could not load tasks')} onRetry={refetch} />;
  return (
    <Stack spacing={2}>
      {canWrite && <Button variant="outlined" startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>Add task for this record</Button>}
      {isLoading ? <Skeleton variant="rounded" height={100} />
        : tasks.length === 0 ? <EmptyState icon={<TaskIcon />} title="No tasks yet" description="Create a task to track follow-ups for this record." />
          : tasks.map((t) => (
            <Stack key={t._id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Checkbox checked={t.status === 'done'} onChange={() => toggle(t)} slotProps={{ input: { 'aria-label': `Complete ${t.title}` } }} />
              <Box sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setOpenId(t._id)}>
                <Typography variant="body2" fontWeight={500} noWrap sx={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</Typography>
                <Typography variant="caption" color={t.status !== 'done' && t.due && new Date(t.due).getTime() < now ? 'error' : 'text.secondary'}>
                  {t.due ? `Due ${dayjs(t.due).format('MMM D, h:mm A')}` : 'No due date'}{t.assignees.length ? ` · ${t.assignees.map((a) => a.name).join(', ')}` : ''}
                </Typography>
              </Box>
              <Chip size="small" color={PRIORITY_COLOR[t.priority]} variant="outlined" label={t.priority} />
            </Stack>
          ))}
      {creating && <TaskDialog workspaceId={workspaceId} recordId={recordId} recordLabel={recordLabel} onClose={() => setCreating(false)} />}
      {openId && <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />}
    </Stack>
  );
}

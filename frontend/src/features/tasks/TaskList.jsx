import { useState } from 'react';
import { Avatar, AvatarGroup, Box, Checkbox, Chip, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tooltip, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import TaskIcon from '@mui/icons-material/TaskAltRounded';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useListTasksQuery, useUpdateTaskMutation } from '../collab/collabApi';
import { showToast } from '../ui/uiSlice';
import { PRIORITY_COLOR } from './TaskDrawer';

const PAGE_SIZES = [10, 25, 50];

export default function TaskList({ params, onOpen, emptyTitle = 'No tasks here', emptyText, showWorkspaceTasks }) {
  const dispatch = useDispatch();
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const { data, isLoading, isFetching, error, refetch } = useListTasksQuery({ ...params, page: page + 1, limit });
  const [update] = useUpdateTaskMutation();
  const [now] = useState(() => Date.now());

  const toggle = async (t) => {
    try { await update({ id: t._id, status: t.status === 'done' ? 'todo' : 'done' }).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err, 'Could not update the task'), 'error')); }
  };

  if (error) return <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error, 'Could not load tasks')} onRetry={refetch} /></Box>;
  if (isLoading) return <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={160} /></Box>;
  if (!data.data.length) return <EmptyState icon={<TaskIcon />} title={emptyTitle} description={emptyText} />;

  return (
    <TableContainer sx={{ opacity: isFetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
      <Table size="small" sx={{ '& td, & th': { py: 1 } }}>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>Task</TableCell>
            {showWorkspaceTasks && <TableCell>Assignees</TableCell>}
            <TableCell>Priority</TableCell>
            <TableCell>Due</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.data.map((t) => {
            const done = t.status === 'done';
            const overdue = !done && t.due && new Date(t.due).getTime() < now;
            return (
              <TableRow key={t._id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpen(t._id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(t._id)}>
                <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={done} onChange={() => toggle(t)} slotProps={{ input: { 'aria-label': done ? `Reopen ${t.title}` : `Complete ${t.title}` } }} />
                </TableCell>
                <TableCell>
                  <Typography fontWeight={500} sx={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'text.secondary' : 'text.primary' }}>{t.title}</Typography>
                  {t.recordRef && <Typography variant="caption" color="text.secondary">{t.recordRef.label}</Typography>}
                </TableCell>
                {showWorkspaceTasks && (
                  <TableCell>
                    <AvatarGroup max={3} sx={{ justifyContent: 'flex-end', width: 'fit-content' }}>
                      {t.assignees.map((a) => <Tooltip key={a._id} title={a.name}><Avatar sx={{ width: 24, height: 24, fontSize: 12, bgcolor: 'primary.main' }}>{a.name[0]}</Avatar></Tooltip>)}
                    </AvatarGroup>
                  </TableCell>
                )}
                <TableCell><Chip size="small" color={PRIORITY_COLOR[t.priority]} variant={t.priority === 'low' || t.priority === 'normal' ? 'outlined' : 'filled'} label={t.priority} /></TableCell>
                <TableCell>
                  {t.due ? <Typography variant="body2" color={overdue ? 'error' : 'text.primary'} fontWeight={overdue ? 600 : 400}>{dayjs(t.due).format('MMM D, h:mm A')}{overdue ? ' · overdue' : ''}</Typography> : <Typography variant="body2" color="text.disabled">No date</Typography>}
                </TableCell>
                <TableCell><Stack direction="row"><Chip size="small" variant="outlined" label={t.status === 'in_progress' ? 'In progress' : t.status === 'done' ? 'Done' : 'To do'} /></Stack></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <TablePagination component="div" count={data.total} page={page} rowsPerPage={limit} rowsPerPageOptions={PAGE_SIZES} onPageChange={(_e, p) => setPage(p)} onRowsPerPageChange={(e) => { setLimit(Number(e.target.value)); setPage(0); }} />
    </TableContainer>
  );
}

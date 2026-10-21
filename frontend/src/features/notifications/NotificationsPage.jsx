import { useState } from 'react';
import { Box, Button, Card, IconButton, List, ListItem, ListItemButton, ListItemText, Pagination, Skeleton, Stack, Tab, Tabs, Tooltip } from '@mui/material';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import CheckIcon from '@mui/icons-material/DoneRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import BellIcon from '@mui/icons-material/NotificationsNoneRounded';
import { EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useDeleteNotificationMutation, useListNotificationsQuery, useMarkAllReadMutation, useMarkReadMutation } from '../collab/collabApi';
import { showToast } from '../ui/uiSlice';

dayjs.extend(relativeTime);
const LIMIT = 20;

export default function NotificationsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, error, refetch } = useListNotificationsQuery({ unread: tab === 'unread', page, limit: LIMIT });
  const [markRead] = useMarkReadMutation();
  const [markAll] = useMarkAllReadMutation();
  const [remove] = useDeleteNotificationMutation();
  const list = data?.data ?? [];

  const open = (n) => { if (!n.readAt) markRead(n._id); if (n.link) navigate(n.link); };
  const del = async (n) => { try { await remove(n._id).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } };

  return (
    <PageTransition>
      <PageHeader title="Notifications" description="Mentions, comments, task reminders and updates on records you follow." actions={<Button disabled={!data?.unread} onClick={() => markAll()}>Mark all as read</Button>} />
      <Card>
        <Tabs value={tab} onChange={(_e, v) => { setTab(v); setPage(1); }} sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="all" label="All" /><Tab value="unread" label={`Unread${data?.unread ? ` (${data.unread})` : ''}`} />
        </Tabs>
        {error ? <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error)} onRetry={refetch} /></Box>
          : isLoading ? <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={200} /></Box>
            : list.length === 0 ? <EmptyState icon={<BellIcon />} title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'} description="You will see mentions, comments and reminders here." /> : (
              <List disablePadding sx={{ opacity: isFetching ? 0.6 : 1 }}>
                {list.map((n) => (
                  <ListItem key={n._id} disablePadding divider sx={{ bgcolor: n.readAt ? 'transparent' : 'action.hover' }}
                    secondaryAction={(
                      <Stack direction="row">
                        {!n.readAt && <Tooltip title="Mark as read"><IconButton aria-label="Mark as read" onClick={() => markRead(n._id)}><CheckIcon fontSize="small" /></IconButton></Tooltip>}
                        <Tooltip title="Delete"><IconButton aria-label="Delete notification" onClick={() => del(n)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </Stack>
                    )}>
                    <ListItemButton onClick={() => open(n)} sx={{ pr: 12, gap: 1.5, alignItems: 'flex-start' }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', mt: 1, flexShrink: 0, bgcolor: n.readAt ? 'transparent' : 'primary.main' }} />
                      <ListItemText primary={n.title} secondary={<>{n.body ? <>{n.body}<br /></> : null}{dayjs(n.createdAt).fromNow()}</>} slotProps={{ primary: { fontWeight: n.readAt ? 400 : 600 } }} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
        {data && data.total > LIMIT && <Stack sx={{ p: 2, alignItems: 'center' }}><Pagination count={Math.ceil(data.total / LIMIT)} page={page} onChange={(_e, p) => setPage(p)} /></Stack>}
      </Card>
    </PageTransition>
  );
}

import { useState } from 'react';
import { Badge, Box, Button, Divider, IconButton, List, ListItemButton, ListItemText, Popover, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import NotificationsIcon from '@mui/icons-material/NotificationsNoneRounded';
import { useListNotificationsQuery, useMarkAllReadMutation, useMarkReadMutation, useUnreadCountQuery } from '../collab/collabApi';

dayjs.extend(relativeTime);

export default function NotificationBell() {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null);
  const { data: unread = 0 } = useUnreadCountQuery();
  const { data, isLoading } = useListNotificationsQuery({ limit: 8 }, { skip: !anchor });
  const [markRead] = useMarkReadMutation();
  const [markAll] = useMarkAllReadMutation();

  const open = async (n) => {
    setAnchor(null);
    if (!n.readAt) markRead(n._id);
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Badge badgeContent={unread} color="error" max={99}><NotificationsIcon /></Badge>
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { width: 380, maxWidth: '95vw' } } }}>
        <Stack direction="row" sx={{ px: 2, py: 1.25, alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography fontWeight={600}>Notifications</Typography>
          <Button size="small" disabled={!unread} onClick={() => markAll()}>Mark all read</Button>
        </Stack>
        <Divider />
        {isLoading ? <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={120} /></Box>
          : !data?.data.length ? <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>You are all caught up.</Typography> : (
            <List disablePadding sx={{ maxHeight: 420, overflowY: 'auto' }}>
              {data.data.map((n) => (
                <ListItemButton key={n._id} onClick={() => open(n)} sx={{ borderRadius: 0, alignItems: 'flex-start', gap: 1.25, bgcolor: n.readAt ? 'transparent' : 'action.hover' }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', mt: 1, flexShrink: 0, bgcolor: n.readAt ? 'transparent' : 'primary.main' }} />
                  <ListItemText
                    primary={n.title} secondary={<>{n.body ? <>{n.body}<br /></> : null}{dayjs(n.createdAt).fromNow()}</>}
                    slotProps={{ primary: { variant: 'body2', fontWeight: n.readAt ? 400 : 600 }, secondary: { variant: 'caption', noWrap: false } }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        <Divider />
        <Box sx={{ p: 1, textAlign: 'center' }}><Button size="small" onClick={() => { setAnchor(null); navigate('/notifications'); }}>Open notification centre</Button></Box>
      </Popover>
    </>
  );
}

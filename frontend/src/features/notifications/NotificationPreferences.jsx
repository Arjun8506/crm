import { useState } from 'react';
import { Alert, Button, Card, Skeleton, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { errorMessage } from '../../services/api';
import { useGetPreferencesQuery, useSavePreferencesMutation } from '../collab/collabApi';
import { showToast } from '../ui/uiSlice';

const LABELS = {
  mention: 'Someone mentions me', comment: 'New comment on a record I follow', record_update: 'A record I follow is updated',
  task_assigned: 'A task is assigned to me', task_comment: 'Comment on one of my tasks', task_reminder: 'A task reminder fires',
  task_due: 'A task is due within 24 hours', task_overdue: 'A task becomes overdue', attachment: 'A file is added to a record I follow',
  message_received: 'A customer replies by email, SMS or WhatsApp', workflow: 'A workflow notifies me', workflow_failed: 'A workflow I created fails',
};

export default function NotificationPreferences() {
  const dispatch = useDispatch();
  const { data, isLoading } = useGetPreferencesQuery();
  const [save, { isLoading: saving }] = useSavePreferencesMutation();
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));

  if (isLoading || !data) return <Card sx={{ p: 3 }}><Skeleton variant="rounded" height={260} /></Card>;
  const inApp = data.preferences.inApp ?? {};
  const email = data.preferences.email ?? {};
  const change = async (channel, type, value) => {
    const next = { inApp: { ...inApp }, email: { ...email } };
    next[channel][type] = value;
    try { await save(next).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err, 'Could not save preferences'), 'error')); }
  };

  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="h6">Notifications</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Choose how you hear about activity. Changes save as you go.</Typography>
      {!data.emailConfigured && (
        <Alert severity="info" sx={{ mb: 2 }}>Email delivery is not set up on this server (no SMTP configured), so no emails are sent yet. Your email choices are saved and take effect once an administrator configures it.</Alert>
      )}
      <Table size="small" sx={{ '& td, & th': { py: 0.5 } }}>
        <TableHead><TableRow><TableCell>When</TableCell><TableCell align="center">In the app</TableCell><TableCell align="center">By email</TableCell></TableRow></TableHead>
        <TableBody>
          {data.types.map((t) => (
            <TableRow key={t}>
              <TableCell>{LABELS[t] ?? t}</TableCell>
              <TableCell align="center"><Switch size="small" checked={inApp[t] !== false} disabled={saving} onChange={(e) => change('inApp', t, e.target.checked)} slotProps={{ input: { 'aria-label': `${LABELS[t]}: in the app` } }} /></TableCell>
              <TableCell align="center"><Switch size="small" checked={email[t] === true} disabled={saving} onChange={(e) => change('email', t, e.target.checked)} slotProps={{ input: { 'aria-label': `${LABELS[t]}: by email` } }} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Stack direction="row" spacing={2} sx={{ mt: 2.5, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        {perm === 'unsupported' ? <Typography variant="body2" color="text.secondary">This browser does not support desktop notifications.</Typography> : perm === 'granted' ? (
          <Typography variant="body2">Desktop notifications are on. You get one when a notification arrives while this tab is in the background.</Typography>
        ) : perm === 'denied' ? (
          <Typography variant="body2" color="text.secondary">Desktop notifications are blocked in your browser settings.</Typography>
        ) : (
          <Button variant="outlined" onClick={async () => setPerm(await Notification.requestPermission())}>Enable desktop notifications</Button>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Mobile push (FCM / APNS) is not available yet.</Typography>
    </Card>
  );
}

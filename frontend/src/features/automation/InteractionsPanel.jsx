import { useState } from 'react';
import { Alert, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Skeleton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { Link as RouterLink } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import CallIcon from '@mui/icons-material/PhoneOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import EmailIcon from '@mui/icons-material/EmailOutlined';
import NoteIcon from '@mui/icons-material/StickyNote2Outlined';
import SlackIcon from '@mui/icons-material/TagRounded';
import SmsIcon from '@mui/icons-material/SmsOutlined';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { selectCan } from '../auth/authSlice';
import { useGetRecordQuery } from '../records/recordsApi';
import { showToast } from '../ui/uiSlice';
import { FieldChips } from './FormulaField';
import {
  useDeleteInteractionMutation, useGetChannelsQuery, useListInteractionsQuery, useListTemplatesQuery, useLogInteractionMutation, useRenderTemplateMutation, useSendMessageMutation,
} from './automationApi';

dayjs.extend(relativeTime);
const ICON = { email: <EmailIcon />, sms: <SmsIcon />, whatsapp: <WhatsAppIcon />, call: <CallIcon />, note: <NoteIcon />, slack: <SlackIcon /> };
const NAME = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', slack: 'Slack', call: 'Call', note: 'Note' };
const STATUS_COLOR = { queued: 'info', sent: 'default', delivered: 'success', failed: 'error', received: 'primary', logged: 'default' };

function ComposeDialog({ channel, dataformId, recordId, workspaceId, fields, onClose }) {
  const dispatch = useDispatch();
  const { data } = useGetRecordQuery({ dataformId, recordId });
  const { data: templates = [] } = useListTemplatesQuery({ workspaceId, channel });
  const [send, { isLoading }] = useSendMessageMutation();
  const [render] = useRenderTemplateMutation();
  const field = fields.find((f) => f.type === (channel === 'email' ? 'email' : 'phone') && data?.record?.data?.[f.key]);
  const [to, setTo] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const recipient = to ?? (field ? data.record.data[field.key] : '');

  const applyTemplate = async (id) => {
    const t = templates.find((x) => x._id === id);
    if (!t) return;
    try { const r = await render({ dataformId, recordId, subject: t.subject, body: t.body }).unwrap(); setSubject(r.subject); setBody(r.body); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  const submit = async (e) => {
    e.preventDefault();
    try {
      await send({ dataformId, recordId, channel, to: recipient, subject, body }).unwrap();
      dispatch(showToast(`${NAME[channel]} queued. Its delivery status appears on the timeline.`));
      onClose();
    } catch (err) {
      dispatch(showToast(errorMessage(err, 'Could not send the message'), 'error'));
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>New {NAME[channel]} message</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label={channel === 'email' ? 'To' : 'To (international format)'} required value={recipient} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'email' ? 'name@example.com' : '+14155550123'}
              helperText={field ? `From the record's ${field.label} field` : `This record has no ${channel === 'email' ? 'email' : 'phone'} value, so type one`} />
            {templates.length > 0 && (
              <TextField select size="small" label="Start from a template" value="" onChange={(e) => applyTemplate(e.target.value)}>
                {templates.map((t) => <MenuItem key={t._id} value={t._id}>{t.name}</MenuItem>)}
              </TextField>
            )}
            {channel === 'email' && <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
            <Box>
              <TextField fullWidth required multiline minRows={channel === 'email' ? 6 : 3} label="Message" value={body} onChange={(e) => setBody(e.target.value)} helperText="Variables like {{name}} are filled in from the record when sent." />
              <FieldChips fields={fields} wrap="{{}}" onInsert={(token) => setBody((b) => `${b}${token}`)} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button color="inherit" onClick={onClose}>Cancel</Button><Button type="submit" variant="contained" disabled={isLoading || !recipient.trim() || !body.trim()}>Send</Button></DialogActions>
      </form>
    </Dialog>
  );
}

function LogDialog({ kind, dataformId, recordId, onClose }) {
  const dispatch = useDispatch();
  const [log, { isLoading }] = useLogInteractionMutation();
  const [v, setV] = useState({ direction: 'outbound', outcome: '', minutes: '', body: '' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await log({ dataformId, recordId, channel: kind, body: v.body, ...(kind === 'call' ? { direction: v.direction, ...(v.outcome ? { outcome: v.outcome } : {}), ...(v.minutes !== '' ? { durationSec: Math.round(Number(v.minutes) * 60) } : {}) } : {}) }).unwrap();
      dispatch(showToast(kind === 'call' ? 'Call logged' : 'Note added'));
      onClose();
    } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>{kind === 'call' ? 'Log a call' : 'Add a note'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {kind === 'call' && (
              <>
                <Alert severity="info" sx={{ py: 0 }}>This records a call you made. It does not place one.</Alert>
                <Stack direction="row" spacing={2}>
                  <TextField select label="Direction" value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value })} fullWidth><MenuItem value="outbound">I called them</MenuItem><MenuItem value="inbound">They called me</MenuItem></TextField>
                  <TextField type="number" label="Minutes" value={v.minutes} onChange={(e) => setV({ ...v, minutes: e.target.value })} slotProps={{ htmlInput: { min: 0, max: 1440, step: 1 } }} sx={{ width: 120 }} />
                </Stack>
                <TextField label="Outcome" placeholder="Interested, voicemail, no answer…" value={v.outcome} onChange={(e) => setV({ ...v, outcome: e.target.value })} />
              </>
            )}
            <TextField autoFocus required multiline minRows={3} label={kind === 'call' ? 'What was discussed' : 'Note'} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button color="inherit" onClick={onClose}>Cancel</Button><Button type="submit" variant="contained" disabled={isLoading || !v.body.trim()}>Save</Button></DialogActions>
      </form>
    </Dialog>
  );
}

function Entry({ i, canDelete, onDelete }) {
  const inbound = i.direction === 'inbound';
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Avatar sx={{ width: 36, height: 36, bgcolor: inbound ? 'primary.main' : 'action.selected', color: inbound ? 'primary.contrastText' : 'text.secondary' }}>{ICON[i.channel]}</Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="body2" fontWeight={600}>{NAME[i.channel]}{i.channel === 'call' ? (inbound ? ' · incoming' : ' · outgoing') : i.channel === 'note' || i.channel === 'slack' ? '' : inbound ? ' received' : ' sent'}</Typography>
          <Chip size="small" color={STATUS_COLOR[i.status]} variant={i.status === 'logged' ? 'outlined' : 'filled'} label={i.status} />
          {i.workflow && <Chip size="small" variant="outlined" label={`Workflow: ${i.workflow.name}`} />}
        </Stack>
        <Typography variant="caption" color="text.secondary" title={dayjs(i.createdAt).format('MMM D, YYYY h:mm A')}>
          {inbound ? `From ${i.from ?? 'unknown'}` : i.to ? `To ${i.to}` : i.user?.name ? `By ${i.user.name}` : ''}{(i.to || i.from) && i.user?.name ? ` · ${i.user.name}` : ''} · {dayjs(i.createdAt).fromNow()}
        </Typography>
        {i.subject && <Typography variant="body2" fontWeight={500} sx={{ mt: 0.5 }}>{i.subject}</Typography>}
        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{i.body}</Typography>
        {i.channel === 'call' && (i.outcome || i.durationSec !== undefined) && <Typography variant="caption" color="text.secondary">{[i.outcome, i.durationSec !== undefined ? `${Math.max(1, Math.round(i.durationSec / 60))} min` : null].filter(Boolean).join(' · ')}</Typography>}
        {i.status === 'failed' && i.error && <Alert severity="error" sx={{ mt: 1, py: 0 }}>{i.error}</Alert>}
      </Box>
      {canDelete && ['call', 'note'].includes(i.channel) && <Tooltip title="Delete"><IconButton size="small" aria-label="Delete entry" onClick={onDelete}><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
    </Stack>
  );
}

export default function InteractionsPanel({ dataformId, recordId, workspaceId, fields, canWrite, canModerate, meId }) {
  const dispatch = useDispatch();
  const isAdmin = useSelector(selectCan('account:update'));
  const { data, isLoading, error, refetch } = useListInteractionsQuery({ dataformId, recordId });
  const { data: channels } = useGetChannelsQuery();
  const [remove] = useDeleteInteractionMutation();
  const [dialog, setDialog] = useState(null);
  const entries = data?.data ?? [];

  const channelButton = (c) => {
    const ok = channels?.[c]?.configured;
    return (
      <Tooltip key={c} title={ok ? '' : `${NAME[c]} is not set up.${isAdmin ? ' Connect it in Settings > Integrations.' : ' Ask an administrator to connect it.'}`}>
        <span><Button size="small" variant="outlined" startIcon={ICON[c]} disabled={!canWrite || !ok} onClick={() => setDialog({ type: 'compose', channel: c })}>{NAME[c]}</Button></span>
      </Tooltip>
    );
  };

  if (error) return <ErrorState message={errorMessage(error, 'Could not load the timeline')} onRetry={refetch} />;
  return (
    <Stack spacing={2.5}>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {['email', 'sms', 'whatsapp'].map(channelButton)}
        <Button size="small" variant="outlined" startIcon={ICON.call} disabled={!canWrite} onClick={() => setDialog({ type: 'log', kind: 'call' })}>Log call</Button>
        <Button size="small" variant="outlined" startIcon={ICON.note} disabled={!canWrite} onClick={() => setDialog({ type: 'log', kind: 'note' })}>Add note</Button>
      </Stack>
      {channels && !channels.email.configured && !channels.sms.configured && isAdmin && (
        <Alert severity="info" action={<Button component={RouterLink} to="/settings/integrations" size="small" color="inherit">Set up</Button>}>Email, SMS and WhatsApp are not connected yet.</Alert>
      )}
      {isLoading ? <Skeleton variant="rounded" height={140} /> : entries.length === 0 ? (
        <EmptyState icon={ICON.email} title="No conversations yet" description="Emails, texts, WhatsApp messages, calls and notes for this record appear here in one timeline." />
      ) : (
        <Stack spacing={2.5}>
          {entries.map((i) => <Entry key={i._id} i={i} canDelete={canWrite && (String(i.user?._id) === meId || canModerate)} onDelete={async () => { try { await remove({ dataformId, recordId, id: i._id }).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }} />)}
        </Stack>
      )}
      {dialog?.type === 'compose' && <ComposeDialog channel={dialog.channel} dataformId={dataformId} recordId={recordId} workspaceId={workspaceId} fields={fields} onClose={() => setDialog(null)} />}
      {dialog?.type === 'log' && <LogDialog kind={dialog.kind} dataformId={dataformId} recordId={recordId} onClose={() => setDialog(null)} />}
    </Stack>
  );
}

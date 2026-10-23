import { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, Chip, MenuItem, Skeleton, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import ExpandIcon from '@mui/icons-material/ExpandMoreRounded';
import { EmptyState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { selectCan } from '../auth/authSlice';
import { showToast } from '../ui/uiSlice';
import { useMyFeedbackQuery, useReopenChecklistMutation, useSendFeedbackMutation } from './businessApi';

dayjs.extend(relativeTime);

const FAQ = [
  ['Getting data in', [
    ['How do I add lots of records at once?', 'Open a dataform, choose Import / export, then Import from CSV. You match your columns to fields, can check the file first without saving anything, and download the rows that had problems.'],
    ['How do I get data out?', 'Import / export also offers a CSV download of what you are looking at, and a background export (CSV, or a ZIP that includes the attached files) for larger sets.'],
    ['Can customers add records themselves?', 'Yes. Workspace admins can create a public form from Import / export, then Public forms. Visitors only see the questions you choose, and every response becomes a normal record.'],
  ]],
  ['Working together', [
    ['How do I share a record with someone who has no account?', 'Open the record and use the share button. You choose which fields to show, and get a read-only link that expires. You can withdraw it at any time.'],
    ['Who can see and change what?', 'Each workspace gives people a level: viewer (read), editor (records) or admin (structure). Account owners and admins are admins everywhere. Private workspaces are visible only to their members.'],
    ['Keyboard shortcut for comments?', 'Press Ctrl+Enter (or Cmd+Enter) to post a comment. Type @ to mention someone.'],
  ]],
  ['Automation and AI', [
    ['What can workflows do?', 'They react to a record being created, changed or deleted, run on a schedule, or run when you press a button. They can check rules before saving, set values, notify people, create tasks and send email, SMS, WhatsApp or Slack messages.'],
    ['Is my data sent to an AI service?', 'Only when an admin has switched AI on and you press an AI button. You are shown what was sent. Email addresses and phone numbers are never sent from fields, and are masked in free text. AI never changes your data by itself: drafts are for you to review.'],
  ]],
  ['Plans and developers', [
    ['What do the plans limit?', 'Workspaces, team members, records, file size, and access to features such as the API, public pages and AI. Billing shows your usage against each limit. Nothing is ever deleted if you move to a smaller plan: you just cannot add beyond its limits.'],
    ['How do I connect another system?', 'Admins can create API keys and signed webhooks under Developers, where the API reference lists every endpoint.'],
  ]],
];

const TYPES = [['idea', 'An idea'], ['bug', 'Something is not working'], ['question', 'A question'], ['praise', 'Something I like']];
const STATUS = { new: 'Received', seen: 'Seen', planned: 'Planned', done: 'Done', closed: 'Closed' };

function FeedbackForm() {
  const dispatch = useDispatch();
  const location = useLocation();
  const [send, { isLoading }] = useSendFeedbackMutation();
  const [type, setType] = useState('question');
  const [message, setMessage] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const res = await send({ type, message: message.trim(), ...(location.state?.from ? { page: location.state.from } : {}) }).unwrap();
      setMessage('');
      dispatch(showToast(res.emailed ? 'Sent. Thank you!' : 'Thank you! Your message was saved for your organisation’s admins.'));
    } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  return (
    <Card sx={{ p: 3, maxWidth: 640 }} component="form" onSubmit={submit} noValidate>
      <Stack spacing={2}>
        <Typography variant="h6">Contact us</Typography>
        <Typography color="text.secondary">Questions, problems and ideas are saved for your organisation’s admins. If this server has a support address and email set up, they are sent there too.</Typography>
        <TextField select label="This is" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField>
        <TextField label="Your message" multiline minRows={4} value={message} onChange={(e) => setMessage(e.target.value)} helperText={`${message.trim().length}/2000`} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        <Button type="submit" variant="contained" disabled={isLoading || message.trim().length < 5} sx={{ alignSelf: 'flex-start' }}>Send</Button>
      </Stack>
    </Card>
  );
}

function Mine() {
  const { data = [], isLoading } = useMyFeedbackQuery();
  if (isLoading) return <Skeleton variant="rounded" height={120} />;
  if (!data.length) return <Card><EmptyState title="Nothing sent yet" description="Your questions and feedback will appear here with their status." /></Card>;
  return (
    <Stack spacing={1.5}>
      {data.map((f) => (
        <Card key={f._id} sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Chip size="small" variant="outlined" label={TYPES.find(([v]) => v === f.type)?.[1]} />
            <Chip size="small" color={f.status === 'done' ? 'success' : f.status === 'planned' ? 'info' : 'default'} label={STATUS[f.status]} />
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1, textAlign: 'right' }}>{dayjs(f.createdAt).fromNow()}</Typography>
          </Stack>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{f.message}</Typography>
        </Card>
      ))}
    </Stack>
  );
}

export default function HelpPage() {
  const dispatch = useDispatch();
  const [tab, setTab] = useState('help');
  const canAdmin = useSelector(selectCan('account:update'));
  const [reopen] = useReopenChecklistMutation();
  return (
    <PageTransition>
      <PageHeader title="Help & feedback" description="Answers to common questions, and a way to reach us." />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="help" label="Help" /><Tab value="contact" label="Contact us" /><Tab value="mine" label="Your messages" />
      </Tabs>
      {tab === 'help' && (
        <Stack spacing={3}>
          {canAdmin && <Alert severity="info" action={<Button color="inherit" size="small" onClick={async () => { await reopen().unwrap(); dispatch(showToast('The getting started list is back on the Workspaces page')); }}>Show it again</Button>}>Hidden the getting started list?</Alert>}
          {FAQ.map(([group, items]) => (
            <Box key={group}>
              <Typography variant="overline" color="text.secondary">{group}</Typography>
              {items.map(([q, a]) => (
                <Accordion key={q} disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandIcon />}><Typography fontWeight={500}>{q}</Typography></AccordionSummary>
                  <AccordionDetails><Typography color="text.secondary">{a}</Typography></AccordionDetails>
                </Accordion>
              ))}
            </Box>
          ))}
        </Stack>
      )}
      {tab === 'contact' && <FeedbackForm />}
      {tab === 'mine' && <Mine />}
    </PageTransition>
  );
}

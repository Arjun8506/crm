import { useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, IconButton, MenuItem, Pagination, Skeleton, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import { EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import {
  useAllFeedbackQuery, useDeleteAnnouncementMutation, useGetNewsQuery, useNpsSummaryQuery, usePostAnnouncementMutation, useSetFeedbackStatusMutation, useUsageSummaryQuery,
} from './businessApi';

const TYPES = { idea: 'Idea', bug: 'Problem', question: 'Question', praise: 'Praise' };
const STATUSES = { new: 'New', seen: 'Seen', planned: 'Planned', done: 'Done', closed: 'Closed' };
const LABELS = { 'page.workspaces': 'Workspaces list', 'page.workspace': 'Workspace home', 'page.dataform': 'Records table', 'page.reports': 'Reports', 'page.dashboards': 'Dashboards', 'page.tasks': 'Tasks', 'page.notifications': 'Notifications', 'page.automation': 'Automation', 'page.team': 'Team', 'page.integrations': 'Integrations', 'page.developers': 'Developers', 'page.billing': 'Billing', 'page.account': 'Account', 'page.help': 'Help', 'page.whatsnew': 'What’s new' };

function FeedbackTab() {
  const dispatch = useDispatch();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const { data, isLoading, error, refetch } = useAllFeedbackQuery({ page, limit: 10, ...(status ? { status } : {}), ...(type ? { type } : {}) });
  const [setFeedbackStatus] = useSetFeedbackStatusMutation();
  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField select size="small" label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} sx={{ minWidth: 150 }}><MenuItem value="">All</MenuItem>{Object.entries(TYPES).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}</TextField>
        <TextField select size="small" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 150 }}><MenuItem value="">All</MenuItem>{Object.entries(STATUSES).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}</TextField>
      </Stack>
      {isLoading ? <Skeleton variant="rounded" height={200} /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : !data.data.length ? <Card><EmptyState title="No feedback" description="Messages people send from Help & feedback appear here." /></Card> : (
        <Stack spacing={1.5}>
          {data.data.map((f) => (
            <Card key={f._id} sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
                <Chip size="small" variant="outlined" label={TYPES[f.type]} />
                <Typography variant="body2" fontWeight={500}>{f.user?.name}</Typography>
                <Typography variant="caption" color="text.secondary">{f.user?.email} · {dayjs(f.createdAt).format('D MMM YYYY HH:mm')}{f.page ? ` · from ${f.page}` : ''}</Typography>
                <Box sx={{ flex: 1 }} />
                <TextField select size="small" value={f.status} onChange={async (e) => { try { await setFeedbackStatus({ id: f._id, status: e.target.value }).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }} slotProps={{ htmlInput: { 'aria-label': 'Status' } }} sx={{ minWidth: 120 }}>
                  {Object.entries(STATUSES).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
                </TextField>
              </Stack>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{f.message}</Typography>
            </Card>
          ))}
          {data.total > 10 && <Pagination count={Math.ceil(data.total / 10)} page={page} onChange={(_e, p) => setPage(p)} />}
        </Stack>
      )}
    </Box>
  );
}

function AnnouncementsTab() {
  const dispatch = useDispatch();
  const { data } = useGetNewsQuery();
  const [post, posting] = usePostAnnouncementMutation();
  const [remove] = useDeleteAnnouncementMutation();
  const [v, setV] = useState({ title: '', body: '', expiresInDays: 0 });
  const mine = (data?.data ?? []).filter((i) => i.kind === 'organisation');
  const submit = async (e) => {
    e.preventDefault();
    try { await post({ title: v.title, body: v.body, expiresInDays: v.expiresInDays || null }).unwrap(); setV({ title: '', body: '', expiresInDays: 0 }); dispatch(showToast('Announcement published')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  return (
    <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      <Card sx={{ p: 3 }} component="form" onSubmit={submit} noValidate>
        <Stack spacing={2}>
          <Typography variant="h6">New announcement</Typography>
          <Typography variant="body2" color="text.secondary">Everyone in your organisation sees it under What’s new, with a marker until they have read it.</Typography>
          <TextField label="Title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          <TextField label="Message" multiline minRows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
          <TextField select label="Show for" value={v.expiresInDays} onChange={(e) => setV({ ...v, expiresInDays: Number(e.target.value) })}><MenuItem value={0}>Until I remove it</MenuItem><MenuItem value={7}>7 days</MenuItem><MenuItem value={30}>30 days</MenuItem></TextField>
          <Button type="submit" variant="contained" disabled={posting.isLoading || v.title.trim().length < 2} sx={{ alignSelf: 'flex-start' }}>Publish</Button>
        </Stack>
      </Card>
      <Stack spacing={1.5}>
        {mine.length === 0 ? <Card><EmptyState title="No announcements" /></Card> : mine.map((a) => (
          <Card key={a.id} sx={{ p: 2 }}>
            <Stack direction="row" sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}><Typography fontWeight={600}>{a.title}</Typography><Typography variant="caption" color="text.secondary">{dayjs(a.date).format('D MMM YYYY')}</Typography><Typography color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{a.body}</Typography></Box>
              <Tooltip title="Remove"><IconButton aria-label={`Remove ${a.title}`} onClick={() => remove(a.id)}><DeleteIcon /></IconButton></Tooltip>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

function NpsTab() {
  const { data, isLoading } = useNpsSummaryQuery();
  if (isLoading) return <Skeleton variant="rounded" height={160} />;
  if (!data.responses) return <Card><EmptyState title="No survey answers yet" description="People are asked once they have been here a couple of weeks, and again every three months." /></Card>;
  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
        {[['NPS', data.nps], ['Promoters (9–10)', data.promoters], ['Passives (7–8)', data.passives], ['Detractors (0–6)', data.detractors]].map(([l, n]) => (
          <Card key={l} sx={{ p: 2 }}><Typography variant="caption" color="text.secondary">{l}</Typography><Typography variant="h4">{n}</Typography></Card>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary">Based on {data.responses} answers in the last year. NPS is the share of promoters minus the share of detractors.</Typography>
      {data.recent.map((r, i) => <Card key={i} sx={{ p: 2 }}><Typography variant="caption" color="text.secondary">{r.score}/10{r.name ? ` · ${r.name}` : ''} · {dayjs(r.at).format('D MMM YYYY')}</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{r.comment}</Typography></Card>)}
    </Stack>
  );
}

function UsageTab() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useUsageSummaryQuery(days);
  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>Only the name of the page or feature and when it was used is recorded, against a one-way code instead of a person. No content, no names. People can opt out on their profile, and you can switch this off in Account settings.</Alert>
      <TextField select size="small" label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ mb: 2, minWidth: 160 }}><MenuItem value={7}>Last 7 days</MenuItem><MenuItem value={30}>Last 30 days</MenuItem><MenuItem value={90}>Last 90 days</MenuItem></TextField>
      {isLoading ? <Skeleton variant="rounded" height={200} /> : (
        <>
          {!data.enabled && <Alert severity="warning" sx={{ mb: 2 }}>Collection is switched off for your organisation.</Alert>}
          <Typography sx={{ mb: 1 }}>{data.activePeople} active {data.activePeople === 1 ? 'person' : 'people'}</Typography>
          {data.features.length === 0 ? <Card><EmptyState title="No usage recorded in this period" /></Card> : (
            <Card sx={{ overflowX: 'auto' }}>
              <Table size="small"><TableHead><TableRow><TableCell>Page or feature</TableCell><TableCell align="right">Visits</TableCell><TableCell align="right">People</TableCell></TableRow></TableHead>
                <TableBody>{data.features.map((f) => <TableRow key={f.name}><TableCell>{LABELS[f.name] ?? f.name.replace(/^feature\./, 'Feature: ').replace(/_/g, ' ')}</TableCell><TableCell align="right">{f.events}</TableCell><TableCell align="right">{f.people}</TableCell></TableRow>)}</TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </Box>
  );
}

export default function InsightsPage() {
  const [tab, setTab] = useState('feedback');
  return (
    <PageTransition>
      <PageHeader title="Feedback & insights" description="What your people say and how the product is used." />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="feedback" label="Feedback inbox" /><Tab value="news" label="Announcements" /><Tab value="nps" label="Satisfaction survey" /><Tab value="usage" label="Product usage" />
      </Tabs>
      {tab === 'feedback' && <FeedbackTab />}{tab === 'news' && <AnnouncementsTab />}{tab === 'nps' && <NpsTab />}{tab === 'usage' && <UsageTab />}
    </PageTransition>
  );
}

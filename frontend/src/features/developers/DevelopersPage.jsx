import { useState } from 'react';
import {
  Alert, Box, Button, Card, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Pagination, Skeleton, Stack, Switch, Tab, Table, TableBody, TableCell,
  TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import AddIcon from '@mui/icons-material/AddRounded';
import CopyIcon from '@mui/icons-material/ContentCopyRounded';
import ExpandIcon from '@mui/icons-material/ExpandMoreRounded';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useListWorkspacesQuery } from '../workspaces/workspacesApi';
import { showToast } from '../ui/uiSlice';
import {
  useCreateApiKeyMutation, useCreateWebhookMutation, useDeleteWebhookMutation, useGetOpenApiQuery, useListApiKeysQuery, useListAuditQuery, useListDeliveriesQuery, useListWebhooksQuery,
  useRedeliverMutation, useRevokeApiKeyMutation, useRotateWebhookSecretMutation, useTestWebhookMutation, useUpdateWebhookMutation,
} from './developersApi';

dayjs.extend(relativeTime);
const MONO = { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 };

function CopyField({ value, label }) {
  const dispatch = useDispatch();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <TextField size="small" fullWidth label={label} value={value} slotProps={{ input: { readOnly: true, sx: MONO } }} />
      <Tooltip title="Copy"><IconButton aria-label={`Copy ${label}`} onClick={async () => { await navigator.clipboard?.writeText(value); dispatch(showToast('Copied')); }}><CopyIcon fontSize="small" /></IconButton></Tooltip>
    </Stack>
  );
}

// Shows a secret exactly once, then it is gone for good.
function SecretDialog({ title, secret, label, hint, onClose }) {
  return (
    <Dialog open={!!secret} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>Copy this now. For your security it is not stored in a readable form and will not be shown again.</Alert>
        <CopyField value={secret ?? ''} label={label} />
        {hint && <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{hint}</Typography>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button variant="contained" onClick={onClose}>I have copied it</Button></DialogActions>
    </Dialog>
  );
}

// ---------------- API keys ----------------
function KeyDialog({ open, onClose, onCreated }) {
  const dispatch = useDispatch();
  const { data: workspaces = [] } = useListWorkspacesQuery();
  const [create, { isLoading }] = useCreateApiKeyMutation();
  const [form, setForm] = useState({ name: '', scope: 'read', expiresInDays: 90, workspaceIds: [] });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const submit = async () => {
    try {
      const res = await create({ name: form.name, scope: form.scope, workspaceIds: form.workspaceIds, expiresInDays: form.expiresInDays === 0 ? null : form.expiresInDays }).unwrap();
      onCreated(res.key);
      setForm({ name: '', scope: 'read', expiresInDays: 90, workspaceIds: [] });
      onClose();
    } catch (err) { dispatch(showToast(errorMessage(err, 'Could not create the key'), 'error')); }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New API key</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} helperText="What this key is for, e.g. “Website sync”" autoFocus />
          <TextField select label="Access" value={form.scope} onChange={(e) => set({ scope: e.target.value })} helperText={form.scope === 'read' ? 'Can read workspaces, dataforms and records.' : 'Can also create, change and delete records.'}>
            <MenuItem value="read">Read only</MenuItem>
            <MenuItem value="write">Read and write records</MenuItem>
          </TextField>
          <TextField select label="Workspaces" value={form.workspaceIds} onChange={(e) => set({ workspaceIds: e.target.value })} helperText="Leave empty to allow every workspace." slotProps={{ select: { multiple: true } }}>
            {workspaces.map((w) => <MenuItem key={w._id} value={w._id}>{w.name}</MenuItem>)}
          </TextField>
          <TextField select label="Expires" value={form.expiresInDays} onChange={(e) => set({ expiresInDays: Number(e.target.value) })}>
            <MenuItem value={30}>In 30 days</MenuItem><MenuItem value={90}>In 90 days</MenuItem><MenuItem value={365}>In a year</MenuItem><MenuItem value={0}>Never</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={isLoading || form.name.trim().length < 2} onClick={submit}>Create key</Button>
      </DialogActions>
    </Dialog>
  );
}

function KeysTab() {
  const dispatch = useDispatch();
  const { data = [], isLoading, error, refetch } = useListApiKeysQuery();
  const [revoke, revoking] = useRevokeApiKeyMutation();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const status = (k) => (k.revokedAt ? <Chip size="small" label="Revoked" /> : k.expiresAt && dayjs(k.expiresAt).isBefore(dayjs()) ? <Chip size="small" color="warning" label="Expired" /> : <Chip size="small" color="success" label="Active" />);

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography color="text.secondary" sx={{ maxWidth: 640 }}>Keys let other systems read or change your records over the REST API. Send one as <code>Authorization: Bearer ocrm_…</code> or <code>X-API-Key</code>.</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>New key</Button>
      </Stack>
      {isLoading ? <Skeleton variant="rounded" height={160} /> : error ? <ErrorState message="Could not load API keys" onRetry={refetch} /> : data.length === 0 ? (
        <Card><EmptyState title="No API keys yet" description="Create a key to connect a script, website or another application." /></Card>
      ) : (
        <Card sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Key</TableCell><TableCell>Access</TableCell><TableCell>Last used</TableCell><TableCell>Expires</TableCell><TableCell>Status</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {data.map((k) => (
                <TableRow key={k._id}>
                  <TableCell>{k.name}<Typography variant="caption" color="text.secondary" component="div">by {k.createdBy?.name ?? 'unknown'}</Typography></TableCell>
                  <TableCell sx={MONO}>{k.prefix}…</TableCell>
                  <TableCell>{k.scope === 'write' ? 'Read & write' : 'Read only'}{k.workspaces?.length ? <Typography variant="caption" color="text.secondary" component="div">{k.workspaces.length} workspace{k.workspaces.length === 1 ? '' : 's'}</Typography> : null}</TableCell>
                  <TableCell>{k.lastUsedAt ? dayjs(k.lastUsedAt).fromNow() : 'Never'}</TableCell>
                  <TableCell>{k.expiresAt ? dayjs(k.expiresAt).format('D MMM YYYY') : 'Never'}</TableCell>
                  <TableCell>{status(k)}</TableCell>
                  <TableCell align="right">{!k.revokedAt && <Button size="small" color="error" onClick={() => setConfirm(k)}>Revoke</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <KeyDialog open={open} onClose={() => setOpen(false)} onCreated={setSecret} />
      <SecretDialog title="Your new API key" secret={secret} label="API key" hint="Use it from a server or script. Never put it in a web page or mobile app." onClose={() => setSecret(null)} />
      <ConfirmDialog
        open={!!confirm} title="Revoke this key?" destructive loading={revoking.isLoading} confirmLabel="Revoke"
        message={`Anything using “${confirm?.name}” will stop working immediately. This cannot be undone.`} onClose={() => setConfirm(null)}
        onConfirm={async () => { try { await revoke(confirm._id).unwrap(); dispatch(showToast('Key revoked')); setConfirm(null); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }}
      />
    </Box>
  );
}

// ---------------- webhooks ----------------
function WebhookDialog({ open, hook, events, onClose, onSecret }) {
  const dispatch = useDispatch();
  const [create, creating] = useCreateWebhookMutation();
  const [update, updating] = useUpdateWebhookMutation();
  const [form, setForm] = useState(() => ({ name: hook?.name ?? '', url: hook?.url ?? '', events: hook?.events ?? ['record.created', 'record.updated'] }));
  const toggle = (e) => setForm((f) => ({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] }));
  const submit = async () => {
    try {
      if (hook) await update({ id: hook._id, ...form }).unwrap();
      else onSecret((await create(form).unwrap()).secret);
      dispatch(showToast(hook ? 'Webhook updated' : 'Webhook created'));
      onClose();
    } catch (err) { dispatch(showToast(errorMessage(err, 'Could not save the webhook'), 'error')); }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{hook ? 'Edit webhook' : 'New webhook'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          <TextField label="Endpoint URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/hooks/orgcrm" helperText="Must be https and reachable from the internet. Private and internal addresses are refused." />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Send me</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              {events.map((e) => <FormControlLabel key={e} control={<Checkbox size="small" checked={form.events.includes(e)} onChange={() => toggle(e)} />} label={<Typography variant="body2" sx={MONO}>{e}</Typography>} />)}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={creating.isLoading || updating.isLoading || form.name.trim().length < 2 || !form.url || form.events.length === 0} onClick={submit}>{hook ? 'Save' : 'Create webhook'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function Deliveries({ hook, onClose }) {
  const dispatch = useDispatch();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, isLoading } = useListDeliveriesQuery({ id: hook._id, page, limit: 10, ...(status ? { status } : {}) });
  const [redeliver] = useRedeliverMutation();
  const chip = (s) => <Chip size="small" color={s === 'succeeded' ? 'success' : s === 'failed' ? 'error' : 'default'} label={s === 'queued' ? 'Waiting / retrying' : s} />;
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Deliveries · {hook.name}</DialogTitle>
      <DialogContent>
        <TextField select size="small" label="Show" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ mb: 2, minWidth: 180 }}>
          <MenuItem value="">All</MenuItem><MenuItem value="succeeded">Succeeded</MenuItem><MenuItem value="failed">Failed</MenuItem><MenuItem value="queued">Waiting / retrying</MenuItem>
        </TextField>
        {isLoading ? <Skeleton variant="rounded" height={200} /> : !data?.data.length ? <EmptyState title="No deliveries" description="Events are listed here after they are sent." /> : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>Event</TableCell><TableCell>Status</TableCell><TableCell>Attempts</TableCell><TableCell>Response</TableCell><TableCell>When</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {data.data.map((d) => (
                  <TableRow key={d._id}>
                    <TableCell sx={MONO}>{d.event}</TableCell>
                    <TableCell>{chip(d.status)}</TableCell>
                    <TableCell>{d.attempts}</TableCell>
                    <TableCell>{d.responseStatus ?? '—'}{d.error ? <Typography variant="caption" color="error" component="div">{d.error}</Typography> : null}</TableCell>
                    <TableCell>{dayjs(d.createdAt).fromNow()}</TableCell>
                    <TableCell align="right"><Button size="small" onClick={async () => { await redeliver(d._id); dispatch(showToast('Queued to send again')); }}>Send again</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.total > 10 && <Pagination sx={{ mt: 2 }} count={Math.ceil(data.total / 10)} page={page} onChange={(_e, p) => setPage(p)} />}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

function WebhooksTab() {
  const dispatch = useDispatch();
  const { data, isLoading, error, refetch } = useListWebhooksQuery();
  const [update] = useUpdateWebhookMutation();
  const [remove, removing] = useDeleteWebhookMutation();
  const [rotate] = useRotateWebhookSecretMutation();
  const [test, testing] = useTestWebhookMutation();
  const [dialog, setDialog] = useState(null);
  const [secret, setSecret] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [deliveries, setDeliveries] = useState(null);
  const [results, setResults] = useState({});
  const hooks = data?.data ?? [];
  const run = async (fn, ok) => { try { await fn(); if (ok) dispatch(showToast(ok)); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography color="text.secondary" sx={{ maxWidth: 640 }}>OrgCRM calls your URL when something changes. Every request is signed with <code>X-OrgCRM-Signature</code> so you can verify it came from here. Failed deliveries are retried; after 10 failures in a row a webhook switches itself off.</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>New webhook</Button>
      </Stack>
      {isLoading ? <Skeleton variant="rounded" height={160} /> : error ? <ErrorState message="Could not load webhooks" onRetry={refetch} /> : hooks.length === 0 ? (
        <Card><EmptyState title="No webhooks yet" description="Create one to be notified about new and changed records, tasks, comments and files." /></Card>
      ) : (
        <Stack spacing={2}>
          {hooks.map((h) => (
            <Card key={h._id} sx={{ p: 2.5 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" fontWeight={600}>{h.name}</Typography>
                    {!h.enabled ? <Chip size="small" color="warning" label="Switched off" /> : h.lastStatus === 'failed' ? <Chip size="small" color="error" label="Last delivery failed" /> : h.lastStatus === 'ok' ? <Chip size="small" color="success" label="Working" /> : <Chip size="small" variant="outlined" label="No deliveries yet" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ ...MONO, wordBreak: 'break-all' }}>{h.url}</Typography>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>{h.events.map((e) => <Chip key={e} size="small" variant="outlined" label={e} />)}</Stack>
                  {!h.enabled && h.disabledReason && <Alert severity="warning" sx={{ mt: 1.5 }}>{h.disabledReason}</Alert>}
                  {results[h._id] && <Alert severity={results[h._id].ok ? 'success' : 'error'} sx={{ mt: 1.5 }}>{results[h._id].ok ? `Test delivered. Your server answered ${results[h._id].status}.` : `Test failed: ${results[h._id].error}`}</Alert>}
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                  <FormControlLabel control={<Switch checked={h.enabled} onChange={(e) => run(() => update({ id: h._id, enabled: e.target.checked }).unwrap())} />} label="On" />
                  <Button size="small" disabled={testing.isLoading} onClick={() => run(async () => setResults({ ...results, [h._id]: await test(h._id).unwrap() }))}>Send test</Button>
                  <Button size="small" onClick={() => setDeliveries(h)}>Deliveries</Button>
                  <Button size="small" onClick={() => setDialog({ hook: h })}>Edit</Button>
                  <Button size="small" onClick={() => run(async () => setSecret((await rotate(h._id).unwrap()).secret))}>New secret</Button>
                  <Button size="small" color="error" onClick={() => setConfirm(h)}>Delete</Button>
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
      {dialog && <WebhookDialog open hook={dialog.hook} events={data?.events ?? []} onClose={() => setDialog(null)} onSecret={setSecret} />}
      <SecretDialog title="Signing secret" secret={secret} label="Signing secret" hint="Compute HMAC-SHA256 of “timestamp.body” with this secret and compare it to X-OrgCRM-Signature." onClose={() => setSecret(null)} />
      {deliveries && <Deliveries hook={deliveries} onClose={() => setDeliveries(null)} />}
      <ConfirmDialog
        open={!!confirm} title="Delete this webhook?" destructive loading={removing.isLoading} confirmLabel="Delete" message={`“${confirm?.name}” will stop receiving events and its delivery history is kept only for a short time.`}
        onClose={() => setConfirm(null)} onConfirm={() => run(async () => { await remove(confirm._id).unwrap(); setConfirm(null); }, 'Webhook deleted')}
      />
    </Box>
  );
}

// ---------------- API reference ----------------
const METHOD_COLOR = { get: 'success', post: 'primary', patch: 'warning', put: 'warning', delete: 'error' };

function DocsTab() {
  const { data: spec, isLoading, error, refetch } = useGetOpenApiQuery();
  const [open, setOpen] = useState({});
  if (isLoading) return <Skeleton variant="rounded" height={240} />;
  if (error || !spec) return <ErrorState message="Could not load the API description" onRetry={refetch} />;
  const groups = spec.tags.map((t) => ({ tag: t.name, ops: Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item).filter(([, op]) => op.tags?.includes(t.name)).map(([method, op]) => ({ method, path, op }))) }));
  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ maxWidth: 720 }}>
          <Typography color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>{spec.info.description.split('\n\n').slice(0, 2).join('\n\n').replace(/\*\*/g, '')}</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>Base URL: <code>{spec.servers[0].url}</code></Typography>
        </Box>
        <Button component="a" href="/api/v1/openapi.json" target="_blank" rel="noreferrer" variant="outlined" color="inherit" sx={{ alignSelf: { sm: 'flex-start' }, flexShrink: 0 }}>openapi.json</Button>
      </Stack>
      <Stack spacing={1.5}>
        {groups.map(({ tag, ops }) => (
          <Card key={tag}>
            <Box component="button" type="button" onClick={() => setOpen((o) => ({ ...o, [tag]: !o[tag] }))} aria-expanded={!!open[tag]}
              sx={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', boxSizing: 'border-box', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.5 }}>
              <Typography fontWeight={600}>{tag} <Typography component="span" color="text.secondary" variant="body2">· {ops.length} operations</Typography></Typography>
              <ExpandIcon sx={{ transform: open[tag] ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
            </Box>
            <Collapse in={!!open[tag]} unmountOnExit>
              <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
                {ops.map(({ method, path, op }) => (
                  <Box key={method + path} sx={{ px: 2.5, py: 1.25 }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Chip size="small" color={METHOD_COLOR[method]} label={method.toUpperCase()} sx={{ minWidth: 64, fontWeight: 700 }} />
                      <Typography sx={MONO}>{path}</Typography>
                      {op['x-api-key-scope'] && <Chip size="small" variant="outlined" label={`API key: ${op['x-api-key-scope']}`} />}
                      {op.security?.length === 0 && <Chip size="small" variant="outlined" label="No sign-in" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{op.summary}</Typography>
                  </Box>
                ))}
              </Stack>
            </Collapse>
          </Card>
        ))}
        <Card>
          <Box sx={{ px: 2.5, py: 1.5 }}>
            <Typography fontWeight={600}>Webhook events</Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>{Object.keys(spec.webhooks).map((e) => <Chip key={e} size="small" variant="outlined" label={e} sx={MONO} />)}</Stack>
          </Box>
        </Card>
      </Stack>
    </Box>
  );
}

// ---------------- audit log ----------------
function AuditTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, isLoading, error, refetch } = useListAuditQuery({ page, limit: 20, ...(action ? { action } : {}) });
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography color="text.secondary">Who changed credentials, access, automation and data operations. Kept for about 13 months.</Typography>
        <TextField select size="small" label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} sx={{ minWidth: 220 }}>
          <MenuItem value="">All actions</MenuItem>
          {(data?.actions ?? []).map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
        </TextField>
      </Stack>
      {isLoading ? <Skeleton variant="rounded" height={240} /> : error ? <ErrorState message="Could not load the audit log" onRetry={refetch} /> : !data.data.length ? <Card><EmptyState title="Nothing recorded yet" /></Card> : (
        <Card sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow><TableCell>When</TableCell><TableCell>Who</TableCell><TableCell>Action</TableCell><TableCell>Details</TableCell></TableRow></TableHead>
            <TableBody>
              {data.data.map((a) => (
                <TableRow key={a._id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(a.at).format('D MMM YYYY HH:mm')}</TableCell>
                  <TableCell>{a.user?.name ?? (a.apiKey ? `API key: ${a.apiKey.name}` : 'System')}</TableCell>
                  <TableCell sx={MONO}>{a.action}</TableCell>
                  <TableCell>{a.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.total > 20 && <Pagination sx={{ p: 2 }} count={Math.ceil(data.total / 20)} page={page} onChange={(_e, p) => setPage(p)} />}
        </Card>
      )}
    </Box>
  );
}

export default function DevelopersPage() {
  const [tab, setTab] = useState('keys');
  return (
    <PageTransition>
      <PageHeader title="Developers" description="API keys, webhooks, API reference and the audit log." />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="keys" label="API keys" /><Tab value="webhooks" label="Webhooks" /><Tab value="docs" label="API reference" /><Tab value="audit" label="Audit log" />
      </Tabs>
      {tab === 'keys' && <KeysTab />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'docs' && <DocsTab />}
      {tab === 'audit' && <AuditTab />}
    </PageTransition>
  );
}

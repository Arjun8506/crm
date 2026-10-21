import { useState } from 'react';
import { Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Skeleton, Stack, Switch, TextField, Tooltip, Typography, FormControlLabel } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import CopyIcon from '@mui/icons-material/ContentCopyRounded';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { selectCan } from '../auth/authSlice';
import { showToast } from '../ui/uiSlice';
import {
  useDeleteIntegrationMutation, useListIntegrationsQuery, useRotateIntegrationSecretMutation, useSaveIntegrationMutation, useTestIntegrationMutation,
} from './automationApi';

dayjs.extend(relativeTime);

const KINDS = {
  slack: {
    title: 'Slack', blurb: 'Post workflow messages to a Slack channel using an incoming webhook.',
    secrets: [{ key: 'webhookUrl', label: 'Incoming webhook URL', placeholder: 'https://hooks.slack.com/services/T000/B000/XXXX', type: 'password' }], settings: [{ key: 'label', label: 'Channel name (for your reference)', placeholder: '#sales' }],
    help: 'In Slack: create an app, enable Incoming Webhooks, and add one for the channel you want.',
  },
  twilio: {
    title: 'SMS and WhatsApp (Twilio)', blurb: 'Send and receive text and WhatsApp messages from records. Replies are filed on the matching record.',
    secrets: [{ key: 'accountSid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', type: 'text' }, { key: 'authToken', label: 'Auth token', placeholder: '', type: 'password' }],
    settings: [{ key: 'smsFrom', label: 'SMS sender number', placeholder: '+14155550100' }, { key: 'whatsappFrom', label: 'WhatsApp sender number', placeholder: '+14155550101' }],
    help: 'Use the Twilio console to find your SID and token. WhatsApp needs a sender approved by Twilio. Then paste the two webhook URLs below into your Twilio number / sender settings.',
  },
  smtp: {
    title: 'Email (SMTP)', blurb: 'Send record emails from your own mail server. Without this, the server-wide setting (if any) is used.',
    secrets: [{ key: 'url', label: 'SMTP connection URL', placeholder: 'smtps://user:password@smtp.example.com:465', type: 'password' }], settings: [{ key: 'from', label: 'From address', placeholder: 'Acme <crm@acme.example>' }],
    help: 'Replies sent by customers can be filed on the record by forwarding inbound mail to the webhook URL below with the shared secret.',
  },
};

function Copy({ value, label }) {
  const dispatch = useDispatch();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <TextField size="small" fullWidth label={label} value={value} slotProps={{ input: { readOnly: true, style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 } } }} />
      <Tooltip title="Copy"><IconButton aria-label={`Copy ${label}`} onClick={async () => { await navigator.clipboard?.writeText(value); dispatch(showToast('Copied')); }}><CopyIcon fontSize="small" /></IconButton></Tooltip>
    </Stack>
  );
}

function StatusChip({ it }) {
  if (!it) return <Chip size="small" variant="outlined" label="Not connected" />;
  if (!it.enabled) return <Chip size="small" label="Switched off" />;
  if (it.status?.ok === true) return <Chip size="small" color="success" label={`Working · tested ${dayjs(it.status.lastTestAt).fromNow()}`} />;
  if (it.status?.ok === false) return <Chip size="small" color="error" label="Test failed" />;
  return <Chip size="small" color="warning" label="Connected, not tested" />;
}

function IntegrationCard({ kind, integration, serverEmail }) {
  const meta = KINDS[kind];
  const dispatch = useDispatch();
  const [save, saving] = useSaveIntegrationMutation();
  const [test, testing] = useTestIntegrationMutation();
  const [remove] = useDeleteIntegrationMutation();
  const [rotate] = useRotateIntegrationSecretMutation();
  const [secrets, setSecrets] = useState({});
  const [settings, setSettings] = useState(() => ({ ...(integration?.settings ?? {}) }));
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [secretDialog, setSecretDialog] = useState(null);
  const [confirm, setConfirm] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErrors({}); setResult(null);
    try {
      const res = await save({ kind, secrets, settings }).unwrap();
      setSecrets({});
      dispatch(showToast(integration ? 'Integration updated' : 'Integration connected'));
      if (res.webhookSecret) setSecretDialog(res.webhookSecret);
    } catch (err) {
      const details = err?.data?.error?.details;
      if (Array.isArray(details)) setErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
      else dispatch(showToast(errorMessage(err), 'error'));
    }
  };
  const runTest = async () => {
    setResult(null);
    try { setResult(await test(kind).unwrap()); } catch (err) { setResult({ ok: false, error: errorMessage(err) }); }
  };

  return (
    <Card sx={{ p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ maxWidth: 560 }}><Typography variant="h6">{meta.title}</Typography><Typography variant="body2" color="text.secondary">{meta.blurb}</Typography></Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {kind === 'smtp' && !integration && serverEmail && <Chip size="small" color="info" variant="outlined" label="Server default in use" />}
          <StatusChip it={integration} />
        </Stack>
      </Stack>
      <Box component="form" onSubmit={submit} noValidate sx={{ mt: 2.5 }}>
        <Stack spacing={2} sx={{ maxWidth: 560 }}>
          {meta.secrets.map((f) => (
            <TextField key={f.key} label={f.label} type={f.type} autoComplete="off" placeholder={integration ? integration.secrets[f.key] || 'Saved. Type to replace' : f.placeholder} value={secrets[f.key] ?? ''}
              onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} error={!!errors[`secrets.${f.key}`]} helperText={errors[`secrets.${f.key}`] || (integration ? `Currently ${integration.secrets[f.key]}` : undefined)} />
          ))}
          {meta.settings.map((f) => (
            <TextField key={f.key} label={f.label} placeholder={f.placeholder} value={settings[f.key] ?? ''} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })} error={!!errors[`settings.${f.key}`]} helperText={errors[`settings.${f.key}`]} />
          ))}
          <Typography variant="caption" color="text.secondary">{meta.help}</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button type="submit" variant="contained" disabled={saving.isLoading}>{integration ? 'Save changes' : 'Connect'}</Button>
            {integration && <Button variant="outlined" disabled={testing.isLoading} onClick={runTest}>{testing.isLoading ? 'Testing…' : 'Send a test'}</Button>}
            {integration && <FormControlLabel control={<Switch checked={integration.enabled} onChange={(e) => save({ kind, enabled: e.target.checked })} />} label="Enabled" />}
            {integration && <Button color="error" onClick={() => setConfirm(true)}>Disconnect</Button>}
          </Stack>
          {result && <Alert severity={result.ok ? 'success' : 'error'}>{result.ok ? (result.detail || 'The test message was accepted by the provider.') : result.error}</Alert>}
          {integration?.status?.ok === false && !result && <Alert severity="error">Last test failed: {integration.status.error}</Alert>}
        </Stack>
      </Box>
      {integration && Object.keys(integration.webhooks).length > 0 && (
        <Stack spacing={1.5} sx={{ mt: 3, maxWidth: 560 }}>
          <Typography variant="subtitle2">Webhook URLs to give your provider</Typography>
          {integration.webhooks.status && <Copy label="Delivery status callback" value={integration.webhooks.status} />}
          {integration.webhooks.inbound && <Copy label="Incoming messages" value={integration.webhooks.inbound} />}
          {integration.webhooks.inboundEmail && (
            <>
              <Copy label="Inbound email (send a JSON POST with the X-Webhook-Secret header)" value={integration.webhooks.inboundEmail} />
              <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={async () => setSecretDialog((await rotate(kind).unwrap()).webhookSecret)}>Generate a new shared secret</Button>
            </>
          )}
          {kind === 'twilio' && <Typography variant="caption" color="text.secondary">These only work if this server is reachable from the internet at its public address (PUBLIC_API_URL).</Typography>}
        </Stack>
      )}
      <Dialog open={!!secretDialog} onClose={() => setSecretDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Shared webhook secret</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}><Alert severity="warning">Copy this now. It is not shown again. Send it in the <code>X-Webhook-Secret</code> header of inbound email requests.</Alert><Copy label="Secret" value={secretDialog ?? ''} /></Stack></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button variant="contained" onClick={() => setSecretDialog(null)}>I have copied it</Button></DialogActions>
      </Dialog>
      <ConfirmDialog open={confirm} destructive title={`Disconnect ${meta.title}?`} confirmLabel="Disconnect" message="Workflows and users can no longer use this channel. Message history is kept." onClose={() => setConfirm(false)}
        onConfirm={async () => { try { await remove(kind).unwrap(); setSettings({}); dispatch(showToast('Disconnected')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } setConfirm(false); }} />
    </Card>
  );
}

export default function IntegrationsPage() {
  const canAdmin = useSelector(selectCan('account:update'));
  const { data, isLoading, error, refetch } = useListIntegrationsQuery(undefined, { skip: !canAdmin });
  if (!canAdmin) return <EmptyState title="Administrators only" description="Integrations hold credentials, so only account owners and admins can manage them." />;
  if (error) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
  return (
    <PageTransition>
      <PageHeader title="Integrations" description="Connect the services OrgCRM sends messages through. Credentials are encrypted and are never shown again." />
      {isLoading ? <Skeleton variant="rounded" height={240} /> : (
        <Stack spacing={2.5}>
          <Alert severity="info">A channel only works once it is connected here. Until then the matching buttons and workflow actions are disabled or report that it is not set up. Nothing is ever pretended to be sent.</Alert>
          {Object.keys(KINDS).map((k) => <IntegrationCard key={`${k}-${data.data.find((i) => i.kind === k)?.updatedAt ?? 'none'}`} kind={k} integration={data.data.find((i) => i.kind === k)} serverEmail={data.channels.email.source === 'server'} />)}
        </Stack>
      )}
    </PageTransition>
  );
}

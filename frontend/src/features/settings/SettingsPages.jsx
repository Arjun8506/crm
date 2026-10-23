import { useEffect } from 'react';
import { Alert, Box, Button, Card, Chip, FormControlLabel, LinearProgress, Skeleton, Stack, Switch, ToggleButton, ToggleButtonGroup, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDispatch, useSelector } from 'react-redux';
import { ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { selectCan } from '../auth/authSlice';
import { useUpdateProfileMutation } from '../auth/authApi';
import { useGetAccountQuery, useUpdateAccountMutation } from '../accounts/accountApi';
import { setThemeMode, showToast } from '../ui/uiSlice';
import NotificationPreferences from '../notifications/NotificationPreferences';
import { useAiStatusQuery } from '../ai/aiApi';
import { useDeleteMyUsageMutation } from '../business/businessApi';

const accountSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters'),
  industry: z.string().trim().max(80),
  timezone: z.string().min(1).max(60),
});
const profileSchema = z.object({ name: z.string().trim().min(1, 'Enter your name') });

function UsageBar({ label, value, max }) {
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="body2">{label}</Typography><Typography variant="body2" color="text.secondary">{value} / {max}</Typography></Stack>
      <LinearProgress variant="determinate" value={Math.min(100, (value / max) * 100)} sx={{ mt: 0.75, height: 8, borderRadius: 4 }} />
    </Box>
  );
}

export function AccountSettingsPage() {
  const dispatch = useDispatch();
  const canEdit = useSelector(selectCan('account:update'));
  const { data, isLoading, error, refetch } = useGetAccountQuery();
  const [update, { isLoading: saving }] = useUpdateAccountMutation();
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm({ resolver: zodResolver(accountSchema), defaultValues: { name: '', industry: '', timezone: 'UTC' } });
  const account = data?.account;

  useEffect(() => {
    if (account) reset({ name: account.name, industry: account.settings.industry, timezone: account.settings.timezone });
  }, [account, reset]);

  const onSubmit = async ({ name, industry, timezone }) => {
    try { await update({ name, settings: { industry, timezone } }).unwrap(); dispatch(showToast('Account settings saved')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };

  return (
    <PageTransition>
      <PageHeader title="Account & usage" description="Organization details, plan and current usage." />
      {error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' } }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Organization</Typography>
            {isLoading ? <Skeleton variant="rounded" height={180} /> : (
              <Stack component="form" spacing={2} onSubmit={handleSubmit(onSubmit)} noValidate>
                <TextField label="Organization name" disabled={!canEdit} {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
                <TextField label="Industry" disabled={!canEdit} {...register('industry')} />
                <TextField label="Time zone" disabled={!canEdit} {...register('timezone')} helperText="IANA name, e.g. America/New_York" />
                {canEdit && <Button type="submit" variant="contained" disabled={!isDirty || saving} sx={{ alignSelf: 'flex-start' }}>Save changes</Button>}
              </Stack>
            )}
          </Card>
          <Card sx={{ p: 3 }}>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}>
              <Typography variant="h6">Plan</Typography>
              {account && <Chip color="primary" label={account.plan.toUpperCase()} size="small" />}
            </Stack>
            {isLoading ? <Skeleton variant="rounded" height={120} /> : (
              <Stack spacing={2.5}>
                <UsageBar label="Workspaces" value={data.usage.workspaces} max={account.entitlements.maxWorkspaces} />
                <UsageBar label="Users" value={data.usage.users} max={account.entitlements.maxUsers} />
                <Typography variant="body2" color="text.secondary">Maximum upload size: {account.entitlements.maxUploadMb} MB.</Typography>
                {canEdit && <Button component={RouterLink} to="/settings/billing" variant="outlined" sx={{ alignSelf: 'flex-start' }}>Plan, usage and invoices</Button>}
              </Stack>
            )}
          </Card>
          {canEdit && account && <AiAndPrivacyCard account={account} update={update} />}
        </Box>
      )}
    </PageTransition>
  );
}

// Two switches that decide where information goes, both off-limits to everyone except account admins.
function AiAndPrivacyCard({ account, update }) {
  const dispatch = useDispatch();
  const { data: ai } = useAiStatusQuery();
  const set = async (settings) => { try { await update({ settings }).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } };
  return (
    <Card sx={{ p: 3, gridColumn: { md: '1 / -1' } }}>
      <Typography variant="h6" sx={{ mb: 1 }}>AI assistance and privacy</Typography>
      <Stack spacing={2}>
        <Box>
          <FormControlLabel control={<Switch checked={!!account.settings.aiEnabled} onChange={(e) => set({ aiEnabled: e.target.checked })} />} label="Let people in this organisation use AI assistance" />
          <Typography variant="body2" color="text.secondary">When someone presses an AI button, the selected text or the record’s visible fields (never email or phone fields) are sent to an external AI provider to produce a summary, rewrite or draft. Nothing is sent otherwise.</Typography>
          {ai && !ai.configured && <Alert severity="info" sx={{ mt: 1 }}>No AI provider is set up on this server, so the switch has no effect yet.</Alert>}
          {ai?.configured && ai.limit === 0 && <Alert severity="info" sx={{ mt: 1 }}>Your plan does not include AI requests. {ai.includedFrom ? `They start with the ${ai.includedFrom} plan.` : ''}</Alert>}
          {ai?.configured && ai.limit > 0 && <Typography variant="body2" sx={{ mt: 1 }}>This month: {ai.used} of {ai.limit} AI requests used.</Typography>}
        </Box>
        <Box>
          <FormControlLabel control={<Switch checked={account.settings.analytics !== false} onChange={(e) => set({ analytics: e.target.checked })} />} label="Record anonymous product usage" />
          <Typography variant="body2" color="text.secondary">Which pages and features are used, never what is in them and never by name. People can opt out individually on their profile.</Typography>
        </Box>
      </Stack>
    </Card>
  );
}

function PrivacyCard({ user, update }) {
  const dispatch = useDispatch();
  const [wipe, wiping] = useDeleteMyUsageMutation();
  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>Privacy</Typography>
      <FormControlLabel control={<Switch checked={user?.preferences?.analytics !== false} onChange={async (e) => { try { await update({ preferences: { analytics: e.target.checked } }).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }} />} label="Share anonymous usage with my organisation’s admins" />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Only the name of the page or feature you use and when, under a one-way code instead of your name. Your browser’s Do Not Track setting is always respected.</Typography>
      <Button size="small" color="inherit" variant="outlined" disabled={wiping.isLoading} onClick={async () => { const r = await wipe().unwrap(); dispatch(showToast(`Deleted ${r.deleted} recorded events`)); }}>Delete what has been recorded about me</Button>
    </Card>
  );
}

export function ProfilePage() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const role = useSelector((s) => s.auth.role);
  const mode = useSelector((s) => s.ui.themeMode);
  const [update, { isLoading }] = useUpdateProfileMutation();
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm({ resolver: zodResolver(profileSchema), values: { name: user?.name ?? '' } });

  const onSubmit = async (values) => {
    try { await update(values).unwrap(); dispatch(showToast('Profile saved')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  const onTheme = async (_e, value) => {
    if (!value) return;
    dispatch(setThemeMode(value));
    try { await update({ preferences: { theme: value } }).unwrap(); } catch { /* local preference still applies */ }
  };

  return (
    <PageTransition>
      <PageHeader title="Profile & preferences" description="Your personal details and how the app looks for you." />
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Profile</Typography>
          <Stack component="form" spacing={2} onSubmit={handleSubmit(onSubmit)} noValidate>
            <TextField label="Full name" {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
            <TextField label="Email" value={user?.email ?? ''} disabled />
            <TextField label="Role" value={role ?? ''} disabled />
            <Button type="submit" variant="contained" disabled={!isDirty || isLoading} sx={{ alignSelf: 'flex-start' }}>Save changes</Button>
          </Stack>
        </Card>
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Appearance</Typography>
          <ToggleButtonGroup exclusive value={mode} onChange={onTheme} aria-label="Theme">
            <ToggleButton value="light">Light</ToggleButton>
            <ToggleButton value="dark">Dark</ToggleButton>
            <ToggleButton value="system">System</ToggleButton>
          </ToggleButtonGroup>
        </Card>
        <PrivacyCard user={user} update={update} />
        <Box sx={{ gridColumn: { md: '1 / -1' } }}><NotificationPreferences /></Box>
      </Box>
    </PageTransition>
  );
}

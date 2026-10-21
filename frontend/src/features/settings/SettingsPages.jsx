import { useEffect } from 'react';
import { Box, Button, Card, Chip, LinearProgress, Skeleton, Stack, ToggleButton, ToggleButtonGroup, TextField, Typography } from '@mui/material';
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
                <Typography variant="body2" color="text.secondary">Maximum upload size: {account.entitlements.maxUploadMb} MB. Billing and plan changes arrive in a later phase.</Typography>
              </Stack>
            )}
          </Card>
        </Box>
      )}
    </PageTransition>
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
        <Box sx={{ gridColumn: { md: '1 / -1' } }}><NotificationPreferences /></Box>
      </Box>
    </PageTransition>
  );
}

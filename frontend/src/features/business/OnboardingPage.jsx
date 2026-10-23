import { useState } from 'react';
import { Alert, Box, Button, Card, Checkbox, FormControlLabel, MenuItem, Skeleton, Step, StepLabel, Stepper, Stack, TextField, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { ErrorState, Logo, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { businessApi, useGetOnboardingQuery, useRunSetupMutation, useSkipSetupMutation } from './businessApi';

const STEPS = ['Your organisation', 'First workspace', 'Review'];
const INDUSTRIES = ['Software', 'Professional services', 'Manufacturing', 'Healthcare', 'Finance', 'Retail', 'Education', 'Non-profit', 'Other'];
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();
const MY_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export default function OnboardingPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useGetOnboardingQuery();
  const [setup, { isLoading: saving }] = useRunSetupMutation();
  const [skip] = useSkipSetupMutation();
  const [step, setStep] = useState(0);
  const [v, setV] = useState({ industry: '', timezone: MY_ZONE, workspaceName: 'My workspace', templates: ['contacts'] });
  const set = (patch) => setV((s) => ({ ...s, ...patch }));
  // Update the cached state right away, so the shell does not bounce a finished user back here while it refetches.
  const markDone = () => dispatch(businessApi.util.updateQueryData('getOnboarding', undefined, (d) => { d.setupNeeded = false; }));
  const toggle = (id) => set({ templates: v.templates.includes(id) ? v.templates.filter((t) => t !== id) : [...v.templates, id] });

  const finish = async () => {
    try {
      const res = await setup({ ...v, industry: v.industry || undefined }).unwrap();
      markDone();
      dispatch(showToast('Your workspace is ready'));
      navigate(`/w/${res.workspace._id}`);
    } catch (err) { dispatch(showToast(errorMessage(err, 'Could not finish setup'), 'error')); }
  };
  const later = async () => { try { await skip().unwrap(); markDone(); } finally { navigate('/workspaces'); } };

  if (isLoading) return <Skeleton variant="rounded" height={320} />;
  if (error) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
  if (!data.setupNeeded) return <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => navigate('/workspaces')}>Continue</Button>}>Setup is already complete.</Alert>;

  return (
    <PageTransition>
      <Box sx={{ maxWidth: 760, mx: 'auto' }}>
        <Stack spacing={1} sx={{ alignItems: 'center', mb: 3, textAlign: 'center' }}>
          <Logo />
          <Typography variant="h4" component="h1">Let’s set things up</Typography>
          <Typography color="text.secondary">Three quick steps. You can change everything later.</Typography>
        </Stack>
        <Stepper activeStep={step} sx={{ mb: 3 }}>{STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}</Stepper>
        <Card sx={{ p: { xs: 2.5, sm: 4 } }}>
          {step === 0 && (
            <Stack spacing={2.5}>
              <Typography variant="h6">What kind of organisation is this?</Typography>
              <TextField select label="Industry" value={v.industry} onChange={(e) => set({ industry: e.target.value })} helperText="Optional">
                <MenuItem value=""><em>Prefer not to say</em></MenuItem>{INDUSTRIES.map((i) => <MenuItem key={i} value={i}>{i}</MenuItem>)}
              </TextField>
              <TextField select label="Time zone" value={v.timezone} onChange={(e) => set({ timezone: e.target.value })} helperText="Used for reminders and scheduled workflows.">
                {[...new Set([MY_ZONE, ...ZONES])].map((z) => <MenuItem key={z} value={z}>{z}</MenuItem>)}
              </TextField>
            </Stack>
          )}
          {step === 1 && (
            <Stack spacing={2}>
              <Typography variant="h6">Create your first workspace</Typography>
              <TextField label="Workspace name" value={v.workspaceName} onChange={(e) => set({ workspaceName: e.target.value })} helperText="A team, project or business area, for example “Sales”." />
              <Box>
                <Typography variant="subtitle2">Start with ready-made dataforms</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Each one comes with sensible fields you can change. Pick none to start empty.</Typography>
                <Stack spacing={0.5}>
                  {data.templates.map((t) => (
                    <FormControlLabel key={t.id} control={<Checkbox checked={v.templates.includes(t.id)} onChange={() => toggle(t.id)} />}
                      label={<Box><Typography fontWeight={500}>{t.name} <Typography component="span" variant="caption" color="text.secondary">{t.category}</Typography></Typography><Typography variant="body2" color="text.secondary">{t.description}</Typography></Box>} sx={{ alignItems: 'flex-start', mb: 1 }} />
                  ))}
                </Stack>
              </Box>
            </Stack>
          )}
          {step === 2 && (
            <Stack spacing={1.5}>
              <Typography variant="h6">Ready to go</Typography>
              <Typography>We will create the workspace <b>{v.workspaceName}</b>{v.templates.length ? <> with {v.templates.map((id) => data.templates.find((t) => t.id === id)?.name).join(', ')}</> : ' with no dataforms yet'}.</Typography>
              <Typography color="text.secondary">Time zone: {v.timezone}{v.industry ? ` · Industry: ${v.industry}` : ''}</Typography>
              <Alert severity="info">Next you will see a checklist of what to do after this: adding records, connecting email and more.</Alert>
            </Stack>
          )}
          <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 3 }}>
            <Button color="inherit" onClick={step === 0 ? later : () => setStep(step - 1)}>{step === 0 ? 'Skip for now' : 'Back'}</Button>
            {step < 2
              ? <Button variant="contained" disabled={step === 1 && v.workspaceName.trim().length < 2} onClick={() => setStep(step + 1)}>Next</Button>
              : <Button variant="contained" disabled={saving} onClick={finish}>Create workspace</Button>}
          </Stack>
        </Card>
      </Box>
    </PageTransition>
  );
}

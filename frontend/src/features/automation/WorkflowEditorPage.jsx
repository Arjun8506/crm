import { useState } from 'react';
import { Alert, Autocomplete, Box, Button, Card, Checkbox, Chip, FormControlLabel, ListSubheader, Menu, MenuItem, Skeleton, Stack, Switch, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import AddIcon from '@mui/icons-material/AddRounded';
import ArrowBack from '@mui/icons-material/ArrowBackRounded';
import BoltIcon from '@mui/icons-material/BoltRounded';
import FilterIcon from '@mui/icons-material/FilterAltOutlined';
import PlayIcon from '@mui/icons-material/PlayArrowRounded';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useGetDataformQuery, useListDataformsQuery } from '../dataforms/dataformsApi';
import { showToast } from '../ui/uiSlice';
import ActionCard, { ACTION_TYPES, allowedActions, newAction } from './ActionEditor';
import ConditionTree, { emptyGroup, toApi, toDraft } from './ConditionTree';
import ExecutionsPanel from './ExecutionsPanel';
import {
  useCancelPendingMutation, useCreateWorkflowMutation, useDeleteWorkflowMutation, useGetWorkflowQuery, useRotateWorkflowSecretMutation, useSetWorkflowEnabledMutation, useUpdateWorkflowMutation,
} from './automationApi';

const TRIGGERS = [
  ['pre_save', 'Before a record is saved', 'Can block the save with a message, or adjust values.'],
  ['post_save', 'After a record is saved', 'Runs in the background once the change is saved.'],
  ['pre_delete', 'Before a record is deleted', 'Can stop a delete.'],
  ['post_delete', 'After a record is deleted', 'Runs in the background with a copy of the deleted record.'],
  ['manual', 'Manually, from a record', 'Appears as a button on records.'],
  ['schedule', 'On a schedule', 'Runs for every record on a recurring schedule.'],
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

const defaultTrigger = (type, prev = {}) => ({
  pre_save: { type, events: prev.events ?? ['create', 'update'] },
  post_save: { type, events: prev.events ?? ['create', 'update'] },
  pre_delete: { type }, post_delete: { type },
  manual: { type, label: prev.label ?? '' },
  schedule: { type, schedule: prev.schedule ?? { frequency: 'daily', time: '09:00', dayOfWeek: 1, dayOfMonth: 1, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } },
}[type]);

const Connector = () => <Box sx={{ width: 2, height: 24, bgcolor: 'divider', mx: 'auto' }} aria-hidden />;
const humanPath = (path) => path.replace(/^actions\.(\d+)/, (_m, i) => `Action ${Number(i) + 1}`).replace(/^conditions/, 'Conditions').replace(/\./g, ' › ');

function TriggerCard({ draft, set, locked, dataforms }) {
  const t = draft.trigger;
  const toggle = (event) => set({ ...draft, trigger: { ...t, events: t.events.includes(event) ? t.events.filter((e) => e !== event) : [...t.events, event] } });
  const s = t.schedule;
  const setSchedule = (patch) => set({ ...draft, trigger: { ...t, schedule: { ...s, ...patch } } });
  return (
    <Card sx={{ p: 2.5, borderLeft: 4, borderLeftColor: 'primary.main' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}><BoltIcon color="primary" /><Typography variant="h6">When this happens</Typography></Stack>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField select label="Dataform" value={draft.dataformId} disabled={locked} onChange={(e) => set({ ...draft, dataformId: e.target.value, conditions: emptyGroup(), actions: [] })} fullWidth helperText={locked ? 'A workflow stays with its dataform' : 'Records in this dataform trigger the workflow'}>
            {dataforms.map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
          </TextField>
          <TextField select label="Trigger" value={t.type} onChange={(e) => set({ ...draft, trigger: defaultTrigger(e.target.value, t) })} fullWidth helperText={TRIGGERS.find((x) => x[0] === t.type)?.[2]}>
            {TRIGGERS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
          </TextField>
        </Stack>
        {t.events && (
          <Stack direction="row" spacing={2}>
            <FormControlLabel control={<Checkbox checked={t.events.includes('create')} onChange={() => toggle('create')} />} label="When a record is created" />
            <FormControlLabel control={<Checkbox checked={t.events.includes('update')} onChange={() => toggle('update')} />} label="When a record is updated" />
          </Stack>
        )}
        {t.type === 'manual' && <TextField label="Button label" value={t.label ?? ''} onChange={(e) => set({ ...draft, trigger: { ...t, label: e.target.value } })} placeholder={draft.name || 'Run workflow'} sx={{ maxWidth: 320 }} />}
        {s && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
            <TextField select label="Repeats" value={s.frequency} onChange={(e) => setSchedule({ frequency: e.target.value })} sx={{ minWidth: 140 }}>
              {['hourly', 'daily', 'weekly', 'monthly'].map((f) => <MenuItem key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</MenuItem>)}
            </TextField>
            {s.frequency === 'weekly' && <TextField select label="On" value={s.dayOfWeek} onChange={(e) => setSchedule({ dayOfWeek: Number(e.target.value) })} sx={{ minWidth: 140 }}>{DAYS.map((d, i) => <MenuItem key={d} value={i}>{d}</MenuItem>)}</TextField>}
            {s.frequency === 'monthly' && <TextField type="number" label="Day of month" value={s.dayOfMonth} onChange={(e) => setSchedule({ dayOfMonth: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} helperText="1 to 28" sx={{ width: 140 }} />}
            <TextField type="time" label={s.frequency === 'hourly' ? 'At minute (HH:MM, hour ignored)' : 'At'} value={s.time} onChange={(e) => setSchedule({ time: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 180 }} />
            <Autocomplete options={ZONES} value={s.timezone} disableClearable onChange={(_e, v) => setSchedule({ timezone: v })} renderInput={(p) => <TextField {...p} label="Time zone" />} sx={{ minWidth: 240 }} />
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

function Builder({ workspaceId, workflow, initial, dataforms }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const isNew = !workflow;
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState('builder');
  const [problems, setProblems] = useState([]);
  const [menu, setMenu] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [revealed, setRevealed] = useState(workflow?.webhookSecret ?? null);
  const { data: meta, isLoading: loadingFields } = useGetDataformQuery(draft.dataformId, { skip: !draft.dataformId });
  const [create, createState] = useCreateWorkflowMutation();
  const [update, updateState] = useUpdateWorkflowMutation();
  const [setEnabled] = useSetWorkflowEnabledMutation();
  const [remove] = useDeleteWorkflowMutation();
  const [cancelPending] = useCancelPendingMutation();
  const [rotate] = useRotateWorkflowSecretMutation();
  const fields = meta?.fields ?? [];
  const type = draft.trigger.type;
  const set = (d) => setDraft(d);

  const save = async () => {
    setProblems([]);
    const body = {
      name: draft.name.trim(), description: draft.description, dataformId: draft.dataformId, trigger: draft.trigger,
      conditions: toApi(draft.conditions, fields), actions: draft.actions, onError: draft.onError,
    };
    try {
      if (isNew) {
        const res = await create(body).unwrap();
        dispatch(showToast('Workflow created. It is paused until you switch it on.'));
        navigate(`/w/${workspaceId}/workflows/${res.workflow._id}`, { replace: true });
      } else {
        await update({ id: workflow._id, ...body }).unwrap();
        dispatch(showToast('Workflow saved'));
      }
    } catch (err) {
      const details = err?.data?.error?.details;
      setProblems(Array.isArray(details) ? details.map((d) => ({ path: d.path, message: d.message })) : [{ path: '', message: errorMessage(err, 'Could not save the workflow') }]);
      dispatch(showToast('This workflow has problems. See the list above.', 'error'));
    }
  };

  const problemsFor = (i) => problems.filter((p) => p.path.startsWith(`actions.${i}`)).map((p) => p.message);
  const general = problems.filter((p) => !/^actions\.\d+/.test(p.path));
  const ctx = { fields, dataformId: draft.dataformId, workspaceId, triggerType: type };
  const addable = allowedActions(type);
  const groups = [...new Set(addable.map((t) => ACTION_TYPES[t].group))];

  const actions = (
    <Card sx={{ p: 2.5, borderLeft: 4, borderLeftColor: 'success.main' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}><PlayIcon color="success" /><Typography variant="h6">Then do this</Typography></Stack>
      <Stack spacing={2}>
        {draft.actions.length === 0 && <Typography variant="body2" color="text.secondary">No actions yet. Add the first step below.</Typography>}
        {draft.actions.map((a, i) => (
          <ActionCard
            key={i} index={i} count={draft.actions.length} action={a} ctx={ctx} problems={problemsFor(i)}
            onChange={(n) => set({ ...draft, actions: draft.actions.map((x, j) => (j === i ? n : x)) })} onRemove={() => set({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })}
            onMove={(dir) => { const n = [...draft.actions]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; set({ ...draft, actions: n }); }}
          />
        ))}
        <Button startIcon={<AddIcon />} variant="outlined" sx={{ alignSelf: 'flex-start' }} disabled={draft.actions.length >= 10 || loadingFields} onClick={(e) => setMenu(e.currentTarget)}>Add action</Button>
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
          {groups.flatMap((g) => [<ListSubheader key={g}>{g}</ListSubheader>, ...addable.filter((t) => ACTION_TYPES[t].group === g).map((t) => (
            <MenuItem key={t} onClick={() => { set({ ...draft, actions: [...draft.actions, newAction(t)] }); setMenu(null); }}>{ACTION_TYPES[t].label}</MenuItem>
          ))])}
        </Menu>
        {draft.actions.length >= 10 && <Typography variant="caption" color="text.secondary">A workflow can have up to 10 actions.</Typography>}
      </Stack>
    </Card>
  );

  return (
    <PageTransition>
      <PageHeader
        title={isNew ? 'New workflow' : workflow.name} description={isNew ? 'Choose what starts it, what it checks, and what it does.' : (workflow.lastRunAt ? `Last ran ${dayjs(workflow.lastRunAt).format('MMM D, h:mm A')} · version ${workflow.version}` : `Never run · version ${workflow.version}`)}
        actions={(
          <>
            <Button component={RouterLink} to={`/w/${workspaceId}/workflows`} startIcon={<ArrowBack />} color="inherit">Workflows</Button>
            {!isNew && <FormControlLabel control={<Switch checked={workflow.enabled} onChange={async (e) => { try { await setEnabled({ id: workflow._id, enabled: e.target.checked }).unwrap(); dispatch(showToast(e.target.checked ? 'Workflow is on' : 'Workflow is paused')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }} />} label={workflow.enabled ? 'On' : 'Paused'} />}
            <Button variant="contained" disabled={createState.isLoading || updateState.isLoading || draft.name.trim().length < 2 || !draft.dataformId} onClick={save}>Save</Button>
          </>
        )}
      />
      {!isNew && <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}><Tab value="builder" label="Builder" /><Tab value="runs" label="Run history" /><Tab value="settings" label="Settings" /></Tabs>}

      {tab === 'runs' && <ExecutionsPanel workflowId={workflow._id} />}

      {tab === 'settings' && !isNew && (
        <Stack spacing={2.5} sx={{ maxWidth: 640 }}>
          <Card sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>If an action fails</Typography>
            <TextField select fullWidth value={draft.onError} onChange={(e) => set({ ...draft, onError: e.target.value })} helperText="Save to apply. Failed runs are retried up to 4 times with increasing delays, resuming at the step that failed.">
              <MenuItem value="stop">Stop and retry from the failed step</MenuItem><MenuItem value="continue">Keep going with the remaining actions</MenuItem>
            </TextField>
          </Card>
          {draft.actions.some((a) => a.type === 'webhook') && (
            <Card sx={{ p: 2.5 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>Webhook signing secret</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Receivers verify each call by computing HMAC-SHA256 over <code>{'timestamp + "." + body'}</code> with this secret and comparing it to the <code>X-OrgCRM-Signature</code> header.</Typography>
              <TextField fullWidth value={revealed ?? '•••••••• (hidden)'} slotProps={{ input: { readOnly: true, style: { fontFamily: 'ui-monospace, Consolas, monospace' } } }} />
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <Button size="small" onClick={async () => { const r = await rotate(workflow._id).unwrap(); setRevealed(r.webhookSecret); dispatch(showToast('New secret generated. Update your receiver.')); }}>Generate a new secret</Button>
              </Stack>
            </Card>
          )}
          <Card sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Queued runs</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Cancel runs that are waiting or retrying (for example after pausing the workflow).</Typography>
            <Button color="warning" variant="outlined" onClick={async () => { const r = await cancelPending(workflow._id).unwrap(); dispatch(showToast(`${r.cancelled} run${r.cancelled === 1 ? '' : 's'} cancelled`)); }}>Cancel queued runs</Button>
          </Card>
          <Card sx={{ p: 2.5, borderColor: 'error.main' }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Delete workflow</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Queued runs are cancelled. Past run history is kept.</Typography>
            <Button color="error" variant="outlined" onClick={() => setConfirm(true)}>Delete this workflow</Button>
          </Card>
        </Stack>
      )}

      {tab === 'builder' && (
        <Stack sx={{ maxWidth: 860 }}>
          <Stack spacing={2} sx={{ mb: 2 }}>
            <TextField label="Name" required value={draft.name} onChange={(e) => set({ ...draft, name: e.target.value })} />
            <TextField label="Description (optional)" value={draft.description} onChange={(e) => set({ ...draft, description: e.target.value })} />
          </Stack>
          {general.length > 0 && <Alert severity="error" sx={{ mb: 2 }}><b>This workflow has problems:</b><ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>{general.map((p, i) => <li key={i}>{p.path ? `${humanPath(p.path)}: ` : ''}{p.message}</li>)}</ul></Alert>}
          {problems.some((p) => /^actions\.\d+/.test(p.path)) && <Alert severity="error" sx={{ mb: 2 }}>Some actions need attention. They are marked below.</Alert>}
          <TriggerCard draft={draft} set={set} locked={!isNew} dataforms={dataforms} />
          <Connector />
          <Card sx={{ p: 2.5, borderLeft: 4, borderLeftColor: 'warning.main' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}><FilterIcon color="warning" /><Typography variant="h6">Only if</Typography><Chip size="small" label="optional" /></Stack>
            {loadingFields ? <Skeleton variant="rounded" height={80} /> : <ConditionTree value={draft.conditions} fields={fields} dataformId={draft.dataformId} allowChanged={['pre_save', 'post_save'].includes(type)} onChange={(conditions) => set({ ...draft, conditions })} />}
          </Card>
          <Connector />
          {actions}
        </Stack>
      )}
      <ConfirmDialog
        open={confirm} destructive title={`Delete “${workflow?.name}”?`} confirmLabel="Delete workflow" message="Queued runs are cancelled. Past run history is kept." onClose={() => setConfirm(false)}
        onConfirm={async () => { try { await remove(workflow._id).unwrap(); dispatch(showToast('Workflow deleted')); navigate(`/w/${workspaceId}/workflows`); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }}
      />
    </PageTransition>
  );
}

export default function WorkflowEditorPage() {
  const { workspaceId, workflowId } = useParams();
  const [search] = useSearchParams();
  const isNew = !workflowId;
  const { data: workflow, isLoading: loadingWf, error } = useGetWorkflowQuery(workflowId, { skip: isNew });
  const { data: dataforms = [], isLoading: loadingForms } = useListDataformsQuery({ workspaceId });
  const { data: meta } = useGetDataformQuery(workflow?.dataform, { skip: !workflow });

  if (error) return <EmptyState title="Workflow not found" description="It may have been deleted, or only workspace admins can open it." action={<Button component={RouterLink} to={`/w/${workspaceId}/workflows`}>Back to workflows</Button>} />;
  if (loadingForms || (!isNew && (loadingWf || !meta))) return <Skeleton variant="rounded" height={300} />;
  if (!dataforms.length) return <ErrorState message="Create a dataform first: workflows run on the records of a dataform." />;

  const initial = isNew
    ? { name: '', description: '', dataformId: search.get('dataform') ?? dataforms[0]._id, trigger: defaultTrigger('post_save'), conditions: emptyGroup(), actions: [], onError: 'stop' }
    : { name: workflow.name, description: workflow.description ?? '', dataformId: workflow.dataform, trigger: workflow.trigger, conditions: toDraft(workflow.conditions, meta.fields), actions: workflow.actions, onError: workflow.onError };
  return <Builder key={workflow?._id ?? 'new'} workspaceId={workspaceId} workflow={workflow} initial={initial} dataforms={dataforms} />;
}

import { useMemo, useState } from 'react';
import { Alert, Box, Button, Divider, Drawer, IconButton, Menu, MenuItem, Skeleton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useDispatch, useSelector } from 'react-redux';
import dayjs from 'dayjs';
import CloseIcon from '@mui/icons-material/CloseRounded';
import CopyIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import BoltIcon from '@mui/icons-material/BoltRounded';
import FollowIcon from '@mui/icons-material/NotificationsActiveRounded';
import UnfollowIcon from '@mui/icons-material/NotificationsNoneRounded';
import { ConfirmDialog, EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import AttachmentsPanel from '../collab/AttachmentsPanel';
import CommentsPanel from '../collab/CommentsPanel';
import { useListRecordCommentsQuery, useSetFollowMutation } from '../collab/collabApi';
import RecordTasks from '../tasks/RecordTasks';
import InteractionsPanel from '../automation/InteractionsPanel';
import { useListWorkflowsQuery, useRunWorkflowMutation } from '../automation/automationApi';
import FieldInput from './FieldInput';
import { buildFormSchema, defaultFormValues, formatValue, isFieldEditable, toApiValue } from './fieldUtils';
import {
  useCopyRecordMutation, useCreateRecordMutation, useDeleteRecordMutation, useGetHistoryQuery, useGetRecordQuery, useUpdateRecordMutation,
} from './recordsApi';

function HistoryTab({ dataformId, recordId, fields }) {
  const { data = [], isLoading, error, refetch } = useGetHistoryQuery({ dataformId, recordId });
  const label = (key) => fields.find((f) => f.key === key)?.label ?? key;
  const show = (key, v) => { const f = fields.find((x) => x.key === key); return f ? (formatValue(f, v) || 'empty') : String(v ?? 'empty'); };
  if (isLoading) return <Skeleton variant="rounded" height={120} />;
  if (error) return <ErrorState message="Could not load history" onRetry={refetch} />;
  if (!data.length) return <EmptyState title="No history yet" />;
  return (
    <Stack spacing={2} divider={<Divider />}>
      {data.map((h) => (
        <Box key={h._id}>
          <Typography variant="body2" fontWeight={600}>
            {h.user?.name ?? 'Someone'} {h.action === 'create' ? 'created this record' : h.action === 'delete' ? 'deleted this record' : 'updated this record'}
          </Typography>
          <Typography variant="caption" color="text.secondary">{dayjs(h.at).format('MMM D, YYYY h:mm A')}</Typography>
          {h.action === 'update' && h.changes.map((c) => (
            <Typography key={c.field} variant="body2" sx={{ mt: 0.5 }}>
              <b>{label(c.field)}</b>: <span style={{ opacity: 0.7 }}>{show(c.field, c.from)}</span> → {show(c.field, c.to)}
            </Typography>
          ))}
        </Box>
      ))}
    </Stack>
  );
}

function RecordForm({ dataform, fields, record, refs, canWrite, mode, onClose, onSaved }) {
  const dispatch = useDispatch();
  const [create, createState] = useCreateRecordMutation();
  const [update, updateState] = useUpdateRecordMutation();
  const visible = useMemo(() => fields.filter((f) => mode !== 'create' || f.visibility.create), [fields, mode]);
  const editable = useMemo(() => visible.filter((f) => canWrite && isFieldEditable(f, mode)), [visible, canWrite, mode]);
  const schema = useMemo(() => buildFormSchema(editable), [editable]);
  const { control, handleSubmit, setError, formState: { errors, dirtyFields, isSubmitting } } = useForm({
    resolver: zodResolver(schema), defaultValues: defaultFormValues(visible, mode === 'create' ? null : record),
  });

  const sections = useMemo(() => {
    const map = new Map();
    for (const f of visible) map.set(f.section, [...(map.get(f.section) ?? []), f]);
    return [...map.entries()];
  }, [visible]);

  const onSubmit = async (values) => {
    const byKey = Object.fromEntries(editable.map((f) => [f.key, f]));
    const keys = mode === 'create' ? Object.keys(byKey) : Object.keys(dirtyFields).filter((k) => byKey[k]);
    const data = {};
    for (const k of keys) {
      const v = toApiValue(byKey[k], values[k]);
      if (mode === 'create' && v === null) continue;
      data[k] = v;
    }
    try {
      const res = mode === 'create'
        ? await create({ dataformId: dataform._id, data }).unwrap()
        : await update({ dataformId: dataform._id, recordId: record._id, data }).unwrap();
      dispatch(showToast(mode === 'create' ? 'Record created' : 'Record saved'));
      onSaved(res.record);
    } catch (err) {
      const details = err?.data?.error?.details;
      if (Array.isArray(details)) details.forEach((d) => setError(d.path.replace(/^data\./, ''), { message: d.message }));
      dispatch(showToast(errorMessage(err, 'Could not save the record'), 'error'));
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
        <Stack spacing={3}>
          {sections.map(([name, list]) => (
            <Stack key={name} spacing={2}>
              {sections.length > 1 && <Typography variant="overline" color="text.secondary">{name}</Typography>}
              {list.map((f) => (
                <FieldInput key={f.key} field={f} control={control} errors={errors} refs={refs} disabled={!editable.includes(f)} />
              ))}
            </Stack>
          ))}
        </Stack>
      </Box>
      {canWrite && (
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button color="inherit" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting || createState.isLoading || updateState.isLoading || (mode !== 'create' && Object.keys(dirtyFields).length === 0)}>
            {mode === 'create' ? 'Create record' : 'Save changes'}
          </Button>
        </Stack>
      )}
    </Box>
  );
}

export default function RecordDrawer({ open, dataform, fields, canWrite, canModerate, recordId, onClose }) {
  const dispatch = useDispatch();
  const me = useSelector((st) => st.auth.user);
  const mode = recordId ? 'edit' : 'create';
  const [tab, setTab] = useState('details');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loaded, setLoaded] = useState(null); // updatedAt the form was built from
  const [actionsAnchor, setActionsAnchor] = useState(null);
  const { data, isLoading, error, refetch } = useGetRecordQuery({ dataformId: dataform._id, recordId }, { skip: !recordId });
  const { data: discussion } = useListRecordCommentsQuery({ dataformId: dataform._id, recordId }, { skip: !recordId });
  const [setFollow, followState] = useSetFollowMutation();
  const { data: manualFlows = [] } = useListWorkflowsQuery({ workspaceId: dataform.workspace, dataformId: dataform._id, manual: true }, { skip: !recordId || !canWrite });
  const [runFlow] = useRunWorkflowMutation();
  const [copy] = useCopyRecordMutation();
  const [remove, removeState] = useDeleteRecordMutation();
  const writable = canWrite && dataform.status !== 'archived';
  const title = mode === 'create' ? `New ${dataform.name.replace(/s$/, '')}` : (data?.record && dataform.primaryField ? data.record.data[dataform.primaryField] : null) || 'Record';
  const following = !!discussion?.following;

  // If someone else saves this record while it is open, keep the user's unsaved edits and offer to reload instead of silently resetting the form.
  const latest = data?.record?.updatedAt;
  const baseline = loaded ?? latest;
  const stale = mode === 'edit' && !!latest && !!baseline && latest !== baseline;

  const run = async (fn, ok) => {
    try { await fn().unwrap(); dispatch(showToast(ok)); return true; } catch (err) { dispatch(showToast(errorMessage(err), 'error')); return false; }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, display: 'flex' } } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 3, py: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" noWrap sx={{ flex: 1 }}>{title}</Typography>
        {mode === 'edit' && (
          <Tooltip title={following ? `Following (${discussion?.followers ?? 0}). Click to unfollow` : 'Follow to get notified about comments and changes'}>
            <span>
              <IconButton aria-label={following ? 'Unfollow record' : 'Follow record'} aria-pressed={following} color={following ? 'primary' : 'default'} disabled={followState.isLoading}
                onClick={() => run(() => setFollow({ dataformId: dataform._id, recordId, follow: !following }), following ? 'You stopped following this record' : 'You are now following this record')}>
                {following ? <FollowIcon /> : <UnfollowIcon />}
              </IconButton>
            </span>
          </Tooltip>
        )}
        {mode === 'edit' && writable && manualFlows.length > 0 && (
          <>
            <Button size="small" variant="outlined" startIcon={<BoltIcon />} onClick={(e) => setActionsAnchor(e.currentTarget)} aria-haspopup="menu">Actions</Button>
            <Menu anchorEl={actionsAnchor} open={!!actionsAnchor} onClose={() => setActionsAnchor(null)}>
              {manualFlows.map((w) => (
                <MenuItem key={w._id} onClick={async () => {
                  setActionsAnchor(null);
                  try {
                    const { execution } = await runFlow({ id: w._id, recordId }).unwrap();
                    const label = w.trigger.label || w.name;
                    if (execution.status === 'succeeded') dispatch(showToast(`${label}: done`));
                    else if (execution.status === 'skipped') dispatch(showToast(`${label}: not applicable (${execution.error})`, 'info'));
                    else dispatch(showToast(`${label} ${execution.status}: ${execution.error ?? 'see the run history'}`, 'error'));
                  } catch (err) { dispatch(showToast(errorMessage(err, 'Could not run the action'), 'error')); }
                }}>{w.trigger.label || w.name}</MenuItem>
              ))}
            </Menu>
          </>
        )}
        {mode === 'edit' && writable && (
          <>
            <Tooltip title="Duplicate"><IconButton aria-label="Duplicate record" onClick={async () => { if (await run(() => copy({ dataformId: dataform._id, recordId }), 'Record duplicated')) onClose(); }}><CopyIcon /></IconButton></Tooltip>
            <Tooltip title="Delete"><IconButton aria-label="Delete record" color="error" onClick={() => setConfirmDelete(true)}><DeleteIcon /></IconButton></Tooltip>
          </>
        )}
        <IconButton aria-label="Close" onClick={onClose}><CloseIcon /></IconButton>
      </Stack>
      {mode === 'edit' && (
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="details" label="Details" />
          <Tab value="comments" label="Comments" />
          <Tab value="timeline" label="Timeline" />
          <Tab value="files" label="Files" />
          <Tab value="tasks" label="Tasks" />
          <Tab value="history" label="History" />
        </Tabs>
      )}
      {stale && tab === 'details' && (
        <Alert severity="warning" sx={{ m: 2, mb: 0 }} action={<Button color="inherit" size="small" onClick={() => setLoaded(latest)}>Load latest</Button>}>
          Someone else changed this record. Your edits are kept until you reload.
        </Alert>
      )}
      {error ? <Box sx={{ p: 3 }}><ErrorState message={errorMessage(error, 'Could not load record')} onRetry={refetch} /></Box>
        : isLoading ? <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={240} /></Box>
          : mode === 'edit' && tab !== 'details' ? (
            <Box sx={{ p: 3, overflowY: 'auto' }}>
              {tab === 'history' && <HistoryTab dataformId={dataform._id} recordId={recordId} fields={fields} />}
              {tab === 'comments' && <CommentsPanel kind="record" dataformId={dataform._id} recordId={recordId} canWrite={writable} canModerate={canModerate} />}
              {tab === 'timeline' && <InteractionsPanel dataformId={dataform._id} recordId={recordId} workspaceId={dataform.workspace} fields={fields} canWrite={writable} canModerate={canModerate} meId={me?._id} />}
              {tab === 'files' && <AttachmentsPanel dataformId={dataform._id} recordId={recordId} canWrite={writable} canModerate={canModerate} meId={me?._id} />}
              {tab === 'tasks' && <RecordTasks workspaceId={dataform.workspace} recordId={recordId} recordLabel={title} canWrite={writable} />}
            </Box>
          ) : (
            <RecordForm
              key={`${recordId ?? 'new'}-${baseline ?? ''}`} dataform={dataform} fields={fields} record={data?.record} refs={data?.refs}
              canWrite={writable} mode={mode} onClose={onClose} onSaved={(rec) => (mode === 'create' ? onClose() : setLoaded(rec?.updatedAt ?? null))}
            />
          )}
      <ConfirmDialog
        open={confirmDelete} destructive loading={removeState.isLoading} title="Delete this record?" confirmLabel="Delete"
        message="The record, its comments and its files are removed permanently. Its history entry is kept."
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { if (await run(() => remove({ dataformId: dataform._id, recordId }), 'Record deleted')) { setConfirmDelete(false); onClose(); } }}
      />
    </Drawer>
  );
}

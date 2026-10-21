import { useMemo, useState } from 'react';
import { Box, Button, Divider, Drawer, IconButton, Skeleton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import CloseIcon from '@mui/icons-material/CloseRounded';
import CopyIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import { ConfirmDialog, EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
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

export default function RecordDrawer({ open, dataform, fields, canWrite, recordId, onClose }) {
  const dispatch = useDispatch();
  const mode = recordId ? 'edit' : 'create';
  const [tab, setTab] = useState('details');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data, isLoading, error, refetch } = useGetRecordQuery({ dataformId: dataform._id, recordId }, { skip: !recordId });
  const [copy] = useCopyRecordMutation();
  const [remove, removeState] = useDeleteRecordMutation();
  const writable = canWrite && dataform.status !== 'archived';
  const title = mode === 'create' ? `New ${dataform.name.replace(/s$/, '')}` : (data?.record && dataform.primaryField ? data.record.data[dataform.primaryField] : null) || 'Record';

  const run = async (fn, ok) => {
    try { await fn().unwrap(); dispatch(showToast(ok)); return true; } catch (err) { dispatch(showToast(errorMessage(err), 'error')); return false; }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, display: 'flex' } } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 3, py: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" noWrap sx={{ flex: 1 }}>{title}</Typography>
        {mode === 'edit' && writable && (
          <>
            <Tooltip title="Duplicate"><IconButton aria-label="Duplicate record" onClick={async () => { if (await run(() => copy({ dataformId: dataform._id, recordId }), 'Record duplicated')) onClose(); }}><CopyIcon /></IconButton></Tooltip>
            <Tooltip title="Delete"><IconButton aria-label="Delete record" color="error" onClick={() => setConfirmDelete(true)}><DeleteIcon /></IconButton></Tooltip>
          </>
        )}
        <IconButton aria-label="Close" onClick={onClose}><CloseIcon /></IconButton>
      </Stack>
      {mode === 'edit' && (
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="details" label="Details" /><Tab value="history" label="History" />
        </Tabs>
      )}
      {error ? <Box sx={{ p: 3 }}><ErrorState message={errorMessage(error, 'Could not load record')} onRetry={refetch} /></Box>
        : isLoading ? <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={240} /></Box>
          : tab === 'history' && mode === 'edit' ? <Box sx={{ p: 3, overflowY: 'auto' }}><HistoryTab dataformId={dataform._id} recordId={recordId} fields={fields} /></Box>
            : (
              <RecordForm
                key={`${recordId ?? 'new'}-${data?.record?.updatedAt ?? ''}`} dataform={dataform} fields={fields} record={data?.record} refs={data?.refs}
                canWrite={writable} mode={mode} onClose={onClose} onSaved={() => (mode === 'create' ? onClose() : undefined)}
              />
            )}
      <ConfirmDialog
        open={confirmDelete} destructive loading={removeState.isLoading} title="Delete this record?" confirmLabel="Delete"
        message="The record is removed permanently. Its history entry is kept."
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { if (await run(() => remove({ dataformId: dataform._id, recordId }), 'Record deleted')) { setConfirmDelete(false); onClose(); } }}
      />
    </Drawer>
  );
}

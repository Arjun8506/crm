import { useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Skeleton, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import CopyIcon from '@mui/icons-material/ContentCopyRounded';
import OpenIcon from '@mui/icons-material/OpenInNewRounded';
import { ConfirmDialog, EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import {
  useCreateFormMutation, useDeleteFormMutation, useListFormsQuery, useRegenerateFormLinkMutation, useUpdateFormMutation,
} from '../dataops/dataopsApi';

const local = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const toIso = (v) => (v ? new Date(v).toISOString() : null);

function FormEditor({ dataformId, form, usableFields, onClose }) {
  const dispatch = useDispatch();
  const me = useSelector((s) => s.auth.user?._id ?? s.auth.user?.id);
  const [create, creating] = useCreateFormMutation();
  const [update, updating] = useUpdateFormMutation();
  const [state, setState] = useState(() => ({
    name: form?.name ?? '', description: form?.description ?? '', successMessage: form?.successMessage ?? 'Thank you! Your response has been recorded.',
    fields: form?.fields ?? usableFields.filter((f) => f.required).map((f) => ({ key: f.key })),
    allowFiles: form?.allowFiles ?? false, maxSubmissions: form?.maxSubmissions ?? '', opensAt: local(form?.opensAt), closesAt: local(form?.closesAt),
    notifyMe: !!me && !!form?.notifyUsers?.includes(me),
  }));
  const set = (patch) => setState((s) => ({ ...s, ...patch }));
  const chosen = (key) => state.fields.find((f) => f.key === key);
  const toggle = (key) => set({ fields: chosen(key) ? state.fields.filter((f) => f.key !== key) : [...state.fields, { key }] });
  const patchField = (key, patch) => set({ fields: state.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
  const missing = usableFields.filter((f) => f.required && !chosen(f.key));

  const submit = async () => {
    const body = {
      name: state.name, description: state.description, successMessage: state.successMessage,
      fields: state.fields.map(({ key, label, helpText, required }) => ({ key, ...(label ? { label } : {}), ...(helpText ? { helpText } : {}), ...(required ? { required: true } : {}) })),
      allowFiles: state.allowFiles, maxSubmissions: state.maxSubmissions === '' ? null : Number(state.maxSubmissions),
      opensAt: toIso(state.opensAt), closesAt: toIso(state.closesAt), notifyUsers: state.notifyMe && me ? [me] : [],
    };
    try {
      if (form) await update({ dataformId, formId: form._id, ...body }).unwrap(); else await create({ dataformId, ...body }).unwrap();
      dispatch(showToast(form ? 'Form saved' : 'Form created'));
      onClose();
    } catch (err) { dispatch(showToast(errorMessage(err, 'Could not save the form'), 'error')); }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{form ? 'Edit form' : 'New public form'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Form title" value={state.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
          <TextField label="Introduction" value={state.description} onChange={(e) => set({ description: e.target.value })} multiline minRows={2} />
          <TextField label="Message after sending" value={state.successMessage} onChange={(e) => set({ successMessage: e.target.value })} />
          <Box>
            <Typography variant="subtitle2">Questions</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Visitors can only see and fill in the fields you tick here.</Typography>
            {missing.length > 0 && <Alert severity="warning" sx={{ mb: 1 }}>Required: {missing.map((f) => f.label).join(', ')}</Alert>}
            <Stack spacing={0.5}>
              {usableFields.map((f) => {
                const on = chosen(f.key);
                return (
                  <Stack key={f.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <FormControlLabel sx={{ flex: 1, m: 0 }} control={<Checkbox checked={!!on} onChange={() => toggle(f.key)} />} label={<>{f.label} <Typography component="span" variant="caption" color="text.secondary">{f.type}</Typography></>} />
                    {on && <TextField size="small" placeholder="Custom label" value={on.label ?? ''} onChange={(e) => patchField(f.key, { label: e.target.value })} sx={{ width: 160 }} slotProps={{ htmlInput: { 'aria-label': `Label for ${f.label}` } }} />}
                    {on && <FormControlLabel sx={{ m: 0 }} control={<Checkbox size="small" checked={f.required || !!on.required} disabled={f.required} onChange={(e) => patchField(f.key, { required: e.target.checked })} />} label="Required" />}
                  </Stack>
                );
              })}
            </Stack>
          </Box>
          <FormControlLabel control={<Switch checked={state.allowFiles} onChange={(e) => set({ allowFiles: e.target.checked })} />} label="Let visitors attach up to 3 files" />
          <TextField label="Stop after this many responses" type="number" value={state.maxSubmissions} onChange={(e) => set({ maxSubmissions: e.target.value })} slotProps={{ htmlInput: { min: 1 } }} helperText="Leave empty for no limit." />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Opens" type="datetime-local" value={state.opensAt} onChange={(e) => set({ opensAt: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            <TextField label="Closes" type="datetime-local" value={state.closesAt} onChange={(e) => set({ closesAt: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
          </Stack>
          <FormControlLabel control={<Switch checked={state.notifyMe} onChange={(e) => set({ notifyMe: e.target.checked })} />} label="Notify me about each response" />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={creating.isLoading || updating.isLoading || state.name.trim().length < 2 || state.fields.length === 0} onClick={submit}>{form ? 'Save' : 'Create form'}</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function FormsDialog({ open, dataform, onClose }) {
  const dispatch = useDispatch();
  const { data, isLoading, error, refetch } = useListFormsQuery(dataform._id, { skip: !open });
  const [update] = useUpdateFormMutation();
  const [regen] = useRegenerateFormLinkMutation();
  const [remove, removing] = useDeleteFormMutation();
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const run = async (fn, ok) => { try { await fn(); if (ok) dispatch(showToast(ok)); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } };
  const forms = data?.data ?? [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Public forms for {dataform.name}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2 }}>Anyone with a form’s link can add a record here, without an account, through only the questions you chose. Treat the link like a key: you can replace it at any time.</Typography>
        {isLoading ? <Skeleton variant="rounded" height={140} /> : error ? <ErrorState message="Could not load forms" onRetry={refetch} /> : forms.length === 0 ? <EmptyState title="No forms yet" description="Create a form to collect leads, requests or sign-ups straight into this dataform." /> : (
          <Stack spacing={1.5}>
            {forms.map((f) => (
              <Box key={f._id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography fontWeight={600} sx={{ flex: 1 }}>{f.name}</Typography>
                  <Chip size="small" label={`${f.submissionCount}${f.maxSubmissions ? ` / ${f.maxSubmissions}` : ''} responses`} />
                  <FormControlLabel sx={{ m: 0 }} control={<Switch size="small" checked={f.enabled} onChange={(e) => run(() => update({ dataformId: dataform._id, formId: f._id, enabled: e.target.checked }).unwrap())} />} label={f.enabled ? 'Open' : 'Closed'} />
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
                  <TextField size="small" fullWidth value={f.url} slotProps={{ input: { readOnly: true, sx: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 } }, htmlInput: { 'aria-label': `Link for ${f.name}` } }} />
                  <Tooltip title="Copy link"><IconButton aria-label={`Copy link for ${f.name}`} onClick={async () => { await navigator.clipboard?.writeText(f.url); dispatch(showToast('Link copied')); }}><CopyIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Open"><IconButton aria-label={`Open ${f.name}`} component="a" href={`/f/${f.token}`} target="_blank" rel="noreferrer"><OpenIcon fontSize="small" /></IconButton></Tooltip>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button size="small" onClick={() => setEditing({ form: f })}>Edit</Button>
                  <Button size="small" onClick={() => setConfirm({ kind: 'regen', f })}>New link</Button>
                  <Button size="small" color="error" onClick={() => setConfirm({ kind: 'delete', f })}>Delete</Button>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={() => setEditing({})}>New form</Button>
      </DialogActions>
      {editing && <FormEditor dataformId={dataform._id} form={editing.form} usableFields={data?.usableFields ?? []} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!confirm} destructive loading={removing.isLoading} confirmLabel={confirm?.kind === 'delete' ? 'Delete form' : 'Replace link'}
        title={confirm?.kind === 'delete' ? 'Delete this form?' : 'Replace the link?'}
        message={confirm?.kind === 'delete' ? `“${confirm?.f.name}” will stop accepting responses. Records already collected are kept.` : 'The current link will stop working immediately. Anyone you gave it to will need the new one.'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(async () => {
          if (confirm.kind === 'delete') await remove({ dataformId: dataform._id, formId: confirm.f._id }).unwrap();
          else await regen({ dataformId: dataform._id, formId: confirm.f._id }).unwrap();
          setConfirm(null);
        }, confirm?.kind === 'delete' ? 'Form deleted' : 'New link created')}
      />
    </Dialog>
  );
}

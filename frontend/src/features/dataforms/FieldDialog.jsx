import { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import AddIcon from '@mui/icons-material/AddRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { TYPE_LABELS } from '../records/fieldUtils';
import { useAddFieldMutation, useUpdateFieldMutation } from './dataformsApi';

const UNIQUE_TYPES = new Set(['text', 'email', 'url', 'phone', 'integer', 'decimal', 'date']);
const NUMBER_TYPES = new Set(['integer', 'decimal']);
const toKey = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);

const initial = (field) => field ? {
  label: field.label, key: field.key, type: field.type, description: field.description, section: field.section,
  required: field.required, unique: field.unique, readOnly: field.readOnly, defaultValue: field.defaultValue ?? '',
  min: field.min ?? '', max: field.max ?? '', options: field.options.map((o) => ({ ...o, locked: true })),
  target: field.config?.targetDataform ?? '', visibility: { ...field.visibility },
} : {
  label: '', key: '', type: 'text', description: '', section: 'General', required: false, unique: false, readOnly: false,
  defaultValue: '', min: '', max: '', options: [{ value: '', label: '' }], target: '', visibility: { create: true, edit: true, list: true },
};

export default function FieldDialog({ open, dataformId, field, dataforms, onClose }) {
  const dispatch = useDispatch();
  const editing = !!field;
  const [v, setV] = useState(() => initial(field));
  const [keyTouched, setKeyTouched] = useState(editing);
  const [errors, setErrors] = useState({});
  const [addField, addState] = useAddFieldMutation();
  const [updateField, updateState] = useUpdateFieldMutation();
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));
  const isChoice = v.type === 'dropdown' || v.type === 'multiselect';
  const canDefault = !['relationship', 'multiselect', 'boolean', 'textarea'].includes(v.type);

  const validate = () => {
    const e = {};
    if (!v.label.trim()) e.label = 'Enter a label';
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(v.key)) e.key = 'Lowercase letters, numbers, underscores; start with a letter';
    if (isChoice) {
      const filled = v.options.filter((o) => o.label.trim());
      if (!filled.length) e.options = 'Add at least one option';
      else if (new Set(filled.map((o) => o.value || toKey(o.label))).size !== filled.length) e.options = 'Options must be distinct';
    }
    if (v.type === 'relationship' && !v.target) e.target = 'Choose a dataform to link to';
    if (NUMBER_TYPES.has(v.type) && v.min !== '' && v.max !== '' && Number(v.min) > Number(v.max)) e.min = 'Minimum cannot exceed maximum';
    if (v.required && !v.visibility.create && v.defaultValue === '') e.required = 'A required field hidden on create needs a default value';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    const body = {
      label: v.label.trim(), description: v.description.trim(), section: v.section.trim() || 'General',
      required: v.required, unique: v.unique && UNIQUE_TYPES.has(v.type), readOnly: v.readOnly, visibility: v.visibility,
      defaultValue: canDefault && v.defaultValue !== '' ? (NUMBER_TYPES.has(v.type) ? Number(v.defaultValue) : v.defaultValue) : null,
      min: NUMBER_TYPES.has(v.type) && v.min !== '' ? Number(v.min) : null,
      max: NUMBER_TYPES.has(v.type) && v.max !== '' ? Number(v.max) : null,
      options: isChoice ? v.options.filter((o) => o.label.trim()).map((o) => ({ value: o.value || toKey(o.label), label: o.label.trim() })) : [],
      ...(v.type === 'relationship' ? { config: { targetDataform: v.target } } : {}),
    };
    try {
      if (editing) await updateField({ dataformId, fieldId: field._id, ...body }).unwrap();
      else await addField({ dataformId, key: v.key, type: v.type, ...body }).unwrap();
      dispatch(showToast(editing ? 'Field updated' : 'Field added'));
      onClose();
    } catch (err) {
      const details = err?.data?.error?.details;
      if (Array.isArray(details)) setErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
      dispatch(showToast(errorMessage(err, 'Could not save the field'), 'error'));
    }
  };

  const setOption = (i, patch) => set({ options: v.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>{editing ? `Edit field: ${field.label}` : 'Add field'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Label" autoFocus fullWidth value={v.label} error={!!errors.label} helperText={errors.label}
                onChange={(e) => set({ label: e.target.value, ...(keyTouched ? {} : { key: toKey(e.target.value) }) })} />
              <TextField label="Type" select fullWidth disabled={editing} value={v.type} onChange={(e) => set({ type: e.target.value, defaultValue: '', unique: false })} helperText={editing ? 'The type cannot change after creation' : undefined}>
                {Object.entries(TYPE_LABELS).map(([t, l]) => <MenuItem key={t} value={t}>{l}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField label="Key" disabled={editing} value={v.key} error={!!errors.key} onChange={(e) => { setKeyTouched(true); set({ key: e.target.value }); }}
              helperText={errors.key || (editing ? 'Keys are permanent: record data and the API use them' : 'Used by record data and the API. Cannot change later.')} />
            <TextField label="Description" value={v.description} onChange={(e) => set({ description: e.target.value })} />
            <TextField label="Section" value={v.section} onChange={(e) => set({ section: e.target.value })} helperText="Fields with the same section are grouped together in the record form" />

            {v.type === 'relationship' && (
              <TextField select label="Links to" disabled={editing} value={v.target} error={!!errors['config.targetDataform'] || !!errors.target} helperText={errors.target || errors['config.targetDataform']} onChange={(e) => set({ target: e.target.value })}>
                {dataforms.filter((d) => d.status === 'active').map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
              </TextField>
            )}

            {isChoice && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Options</Typography>
                <Stack spacing={1}>
                  {v.options.map((o, i) => (
                    <Stack key={i} direction="row" spacing={1}>
                      <TextField size="small" fullWidth placeholder="Option label" value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} helperText={o.locked ? `value: ${o.value}` : undefined} />
                      <IconButton aria-label="Remove option" disabled={o.locked} onClick={() => set({ options: v.options.filter((_, j) => j !== i) })}><CloseIcon fontSize="small" /></IconButton>
                    </Stack>
                  ))}
                  {errors.options && <Typography variant="caption" color="error">{errors.options}</Typography>}
                  <Button size="small" startIcon={<AddIcon />} onClick={() => set({ options: [...v.options, { value: '', label: '' }] })} sx={{ alignSelf: 'flex-start' }}>Add option</Button>
                </Stack>
              </Box>
            )}

            {NUMBER_TYPES.has(v.type) && (
              <Stack direction="row" spacing={2}>
                <TextField label="Minimum" type="number" fullWidth value={v.min} error={!!errors.min} helperText={errors.min} onChange={(e) => set({ min: e.target.value })} />
                <TextField label="Maximum" type="number" fullWidth value={v.max} onChange={(e) => set({ max: e.target.value })} />
              </Stack>
            )}

            {canDefault && (
              v.type === 'dropdown'
                ? <TextField select label="Default value" value={v.defaultValue} onChange={(e) => set({ defaultValue: e.target.value })}><MenuItem value=""><em>None</em></MenuItem>{v.options.filter((o) => o.label.trim()).map((o) => <MenuItem key={o.value || o.label} value={o.value || toKey(o.label)}>{o.label}</MenuItem>)}</TextField>
                : <TextField label="Default value" value={v.defaultValue} type={NUMBER_TYPES.has(v.type) ? 'number' : v.type === 'date' ? 'date' : 'text'} slotProps={v.type === 'date' ? { inputLabel: { shrink: true } } : undefined} error={!!errors.defaultValue} helperText={errors.defaultValue} onChange={(e) => set({ defaultValue: e.target.value })} />
            )}

            <Divider />
            <Stack>
              <FormControlLabel control={<Switch checked={v.required} onChange={(e) => set({ required: e.target.checked })} />} label="Required" />
              {errors.required && <Typography variant="caption" color="error">{errors.required}</Typography>}
              {UNIQUE_TYPES.has(v.type) && <FormControlLabel control={<Switch checked={v.unique} onChange={(e) => set({ unique: e.target.checked })} />} label="Unique across records" />}
              <FormControlLabel control={<Switch checked={v.readOnly} onChange={(e) => set({ readOnly: e.target.checked })} />} label="Read-only (cannot be edited by users)" />
            </Stack>
            <Box>
              <Typography variant="body2" color="text.secondary">Show this field in</Typography>
              <Stack direction="row" sx={{ flexWrap: "wrap" }}>
                {[['create', 'Create form'], ['edit', 'Edit form'], ['list', 'Table']].map(([k, l]) => (
                  <FormControlLabel key={k} label={l} control={<Switch checked={v.visibility[k]} onChange={(e) => set({ visibility: { ...v.visibility, [k]: e.target.checked } })} />} />
                ))}
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={addState.isLoading || updateState.isLoading}>{editing ? 'Save field' : 'Add field'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

import { useState } from 'react';
import { Autocomplete, FormControlLabel, FormHelperText, MenuItem, Stack, Switch, TextField } from '@mui/material';
import { Controller } from 'react-hook-form';
import useDebounce from '../../hooks/useDebounce';
import { useQueryRecordsQuery } from './recordsApi';

// Searches the target dataform on the server; stores the selected record id.
export function RecordPicker({ targetDataformId, value, initialLabel, onChange, label, error, helperText, disabled, required, size }) {
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState(value ? { id: value, label: initialLabel || value } : null);
  const q = useDebounce(input, 250);
  const { data, isFetching } = useQueryRecordsQuery({ dataformId: targetDataformId, q, limit: 20, sort: 'createdAt:desc' }, { skip: !targetDataformId });
  const options = (data?.data ?? []).map((r) => ({ id: r._id, label: r._label }));
  const merged = selected && !options.some((o) => o.id === selected.id) ? [selected, ...options] : options;

  return (
    <Autocomplete
      size={size} disabled={disabled} options={merged} loading={isFetching} value={selected}
      filterOptions={(x) => x} isOptionEqualToValue={(a, b) => a.id === b.id} getOptionLabel={(o) => o.label}
      onInputChange={(_e, v, reason) => reason === 'input' && setInput(v)}
      onChange={(_e, v) => { setSelected(v); onChange(v ? v.id : null); }}
      renderInput={(params) => <TextField {...params} label={label} required={required} error={error} helperText={helperText} />}
    />
  );
}

export default function FieldInput({ field, control, errors, disabled, refs }) {
  const error = errors?.[field.key];
  const common = { label: field.label, required: field.required, disabled, error: !!error, helperText: error?.message || field.description || undefined, fullWidth: true };

  return (
    <Controller
      name={field.key} control={control}
      render={({ field: rhf }) => {
        switch (field.type) {
          case 'textarea':
            return <TextField {...common} {...rhf} multiline minRows={3} />;
          case 'integer':
          case 'decimal':
            return <TextField {...common} {...rhf} type="number" slotProps={{ htmlInput: { step: field.type === 'integer' ? 1 : 'any', min: field.min ?? undefined, max: field.max ?? undefined } }} />;
          case 'date':
            return <TextField {...common} {...rhf} type="date" slotProps={{ inputLabel: { shrink: true } }} />;
          case 'datetime':
            return <TextField {...common} {...rhf} type="datetime-local" slotProps={{ inputLabel: { shrink: true } }} />;
          case 'email': return <TextField {...common} {...rhf} type="email" />;
          case 'url': return <TextField {...common} {...rhf} type="url" placeholder="https://" />;
          case 'phone': return <TextField {...common} {...rhf} type="tel" />;
          case 'boolean':
            return (
              <div>
                <FormControlLabel control={<Switch checked={!!rhf.value} onChange={(e) => rhf.onChange(e.target.checked)} disabled={disabled} />} label={field.label} />
                {(error || field.description) && <FormHelperText error={!!error}>{error?.message || field.description}</FormHelperText>}
              </div>
            );
          case 'dropdown':
            return (
              <TextField {...common} {...rhf} select>
                {!field.required && <MenuItem value=""><em>None</em></MenuItem>}
                {field.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            );
          case 'multiselect':
            return (
              <Autocomplete
                multiple disabled={disabled} options={field.options.map((o) => o.value)} value={rhf.value ?? []}
                getOptionLabel={(v) => field.options.find((o) => o.value === v)?.label ?? v} onChange={(_e, v) => rhf.onChange(v)}
                renderInput={(params) => <TextField {...params} label={field.label} required={field.required} error={!!error} helperText={error?.message || field.description || undefined} />}
              />
            );
          case 'location': {
            const v = rhf.value ?? { lat: '', lng: '' };
            const lat = error?.lat ?? error;
            const lng = error?.lng;
            return (
              <Stack direction="row" spacing={1.5}>
                <TextField label={`${field.label}: latitude`} type="number" value={v.lat} onChange={(e) => rhf.onChange({ ...v, lat: e.target.value })} disabled={disabled} fullWidth required={field.required} error={!!lat} helperText={lat?.message || field.description || undefined} slotProps={{ htmlInput: { step: 'any', min: -90, max: 90 } }} />
                <TextField label="Longitude" type="number" value={v.lng} onChange={(e) => rhf.onChange({ ...v, lng: e.target.value })} disabled={disabled} fullWidth required={field.required} error={!!lng} helperText={lng?.message} slotProps={{ htmlInput: { step: 'any', min: -180, max: 180 } }} />
              </Stack>
            );
          }
          case 'relationship':
            return (
              <RecordPicker
                targetDataformId={field.config?.targetDataform} value={rhf.value} initialLabel={refs?.[field.key]?.[rhf.value]}
                onChange={rhf.onChange} label={field.label} required={field.required} disabled={disabled} error={!!error} helperText={error?.message || field.description || undefined}
              />
            );
          default:
            return <TextField {...common} {...rhf} />;
        }
      }}
    />
  );
}

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControl, FormControlLabel, FormGroup, FormHelperText, FormLabel, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import CheckIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import { useGetPublicFormQuery } from '../dataops/dataopsApi';
import PublicLayout from './PublicLayout';

const TEXT_TYPE = { email: 'email', url: 'url', phone: 'tel', integer: 'number', decimal: 'number', date: 'date', datetime: 'datetime-local' };
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

// Raw form values are strings; convert each to what the API expects. Empty answers are left out.
function toApi(field, v) {
  if (isEmpty(v)) return undefined;
  if (field.type === 'integer' || field.type === 'decimal') return Number(v);
  if (field.type === 'datetime') return new Date(v).toISOString();
  if (field.type === 'location') {
    const [lat, lng] = String(v).split(',').map((x) => Number(x.trim()));
    return { lat, lng };
  }
  return v;
}

function Question({ field, value, error, onChange }) {
  const common = { label: field.label, required: field.required, error: !!error, helperText: error || field.helpText || undefined, fullWidth: true };
  if (field.type === 'boolean') {
    return (
      <FormControl error={!!error}>
        <FormControlLabel control={<Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} />} label={field.label + (field.required ? ' *' : '')} />
        {(error || field.helpText) && <FormHelperText>{error || field.helpText}</FormHelperText>}
      </FormControl>
    );
  }
  if (field.type === 'multiselect') {
    const list = value ?? [];
    return (
      <FormControl error={!!error} component="fieldset">
        <FormLabel component="legend" required={field.required}>{field.label}</FormLabel>
        <FormGroup>
          {field.options.map((o) => <FormControlLabel key={o.value} control={<Checkbox checked={list.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} />} label={o.label} />)}
        </FormGroup>
        {(error || field.helpText) && <FormHelperText>{error || field.helpText}</FormHelperText>}
      </FormControl>
    );
  }
  if (field.type === 'dropdown') {
    return (
      <TextField select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {!field.required && <MenuItem value=""><em>Choose…</em></MenuItem>}
        {field.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    );
  }
  const type = TEXT_TYPE[field.type] ?? 'text';
  return (
    <TextField
      {...common} type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} multiline={field.type === 'textarea'} minRows={field.type === 'textarea' ? 3 : undefined}
      placeholder={field.type === 'location' ? 'latitude, longitude' : undefined}
      slotProps={{ inputLabel: ['date', 'datetime'].includes(field.type) ? { shrink: true } : undefined, htmlInput: { ...(type === 'number' ? { min: field.min, max: field.max, step: field.type === 'integer' ? 1 : 'any' } : {}) } }}
    />
  );
}

export default function PublicFormPage() {
  const { token } = useParams();
  const { data, isLoading, error, refetch } = useGetPublicFormQuery(token);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [files, setFiles] = useState([]);
  const [trap, setTrap] = useState('');
  const [state, setState] = useState({ phase: 'editing', message: '', problem: '' });
  const [readyFor, setReadyFor] = useState(null);

  // The server rejects answers that arrive faster than a person could type them, so the button waits a moment.
  useEffect(() => {
    if (!data) return undefined;
    const t = setTimeout(() => setReadyFor(data.formToken), (data.minSeconds ?? 3) * 1000 + 200);
    return () => clearTimeout(t);
  }, [data?.formToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <PublicLayout><Skeleton variant="rounded" height={260} /></PublicLayout>;
  if (error || !data) {
    const closed = error?.status === 410;
    return (
      <PublicLayout title={closed ? 'Form closed' : 'Form not found'}>
        <Stack spacing={1} sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h5" component="h1">{closed ? 'This form is not taking responses' : 'This form is not available'}</Typography>
          <Typography color="text.secondary">{closed ? error.data?.error?.message : 'The link may be wrong or may have been replaced. Please ask whoever sent it to you for a new one.'}</Typography>
        </Stack>
      </PublicLayout>
    );
  }

  const { form } = data;
  const ready = readyFor === data.formToken;
  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    setState((s) => ({ ...s, phase: 'sending', problem: '' }));
    const answers = {};
    for (const f of form.fields) { const v = toApi(f, values[f.key]); if (v !== undefined) answers[f.key] = v; }
    let body; const headers = {};
    if (files.length) {
      body = new FormData();
      body.append('data', JSON.stringify(answers)); body.append('_t', data.formToken); body.append(data.honeypot, trap);
      files.forEach((f) => body.append('files', f));
    } else { body = JSON.stringify({ data: answers, _t: data.formToken, [data.honeypot]: trap }); headers['Content-Type'] = 'application/json'; }
    try {
      const res = await fetch(`/api/v1/public/forms/${token}/submit`, { method: 'POST', headers, body });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { setState({ phase: 'done', message: json.message, problem: '' }); return; }
      const err = json.error ?? {};
      if (err.code === 'FORM_EXPIRED') { refetch(); }
      const fieldErrors = {};
      for (const d of err.details ?? []) if (String(d.path).startsWith('data.')) fieldErrors[d.path.slice(5)] = d.message;
      setErrors(fieldErrors);
      setState({ phase: 'editing', message: '', problem: Object.keys(fieldErrors).length ? 'Please check the highlighted answers.' : err.message || 'Something went wrong. Please try again.' });
    } catch {
      setState({ phase: 'editing', message: '', problem: 'Could not reach the server. Please check your connection and try again.' });
    }
  };

  if (state.phase === 'done') {
    return (
      <PublicLayout title={form.name}>
        <Stack spacing={2} sx={{ textAlign: 'center', alignItems: 'center', py: 4 }} role="status">
          <CheckIcon color="success" sx={{ fontSize: 56 }} />
          <Typography variant="h5" component="h1">{state.message}</Typography>
        </Stack>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={form.name}>
      <Box component="form" onSubmit={submit} noValidate>
        <Typography variant="h5" component="h1">{form.name}</Typography>
        {form.description && <Typography color="text.secondary" sx={{ mt: 1, whiteSpace: 'pre-line' }}>{form.description}</Typography>}
        <Stack spacing={2.5} sx={{ mt: 3 }}>
          {state.problem && <Alert severity="error" role="alert">{state.problem}</Alert>}
          {form.fields.map((f) => <Question key={f.key} field={f} value={values[f.key]} error={errors[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />)}
          {form.allowFiles && (
            <Box>
              <Button component="label" variant="outlined" color="inherit">
                {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} chosen` : 'Attach files'}
                <input type="file" hidden multiple onChange={(e) => setFiles([...e.target.files].slice(0, form.maxFiles))} />
              </Button>
              <FormHelperText>Up to {form.maxFiles} files, {form.maxUploadMb} MB each.</FormHelperText>
            </Box>
          )}
          {/* Honeypot: invisible to people, tempting to bots. */}
          <Box aria-hidden sx={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
            <label>Leave this empty<input tabIndex={-1} autoComplete="off" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} /></label>
          </Box>
          <Button type="submit" variant="contained" size="large" disabled={state.phase === 'sending' || !ready}>{state.phase === 'sending' ? 'Sending…' : 'Send'}</Button>
        </Stack>
      </Box>
    </PublicLayout>
  );
}

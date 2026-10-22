import { useEffect, useMemo, useRef, useState } from 'react';
import usePoll from './usePoll';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Stack, Step, StepLabel, Stepper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import UploadIcon from '@mui/icons-material/UploadFileRounded';
import { api, errorMessage } from '../../services/api';
import { store } from '../../app/store';
import { downloadFile } from '../../services/download';
import { showToast } from '../ui/uiSlice';
import { isSettled, useCancelImportMutation, useGetImportQuery, useListImportsQuery, useStartImportMutation, useUploadImportMutation } from './dataopsApi';

dayjs.extend(relativeTime);
const STEPS = ['Choose file', 'Match columns', 'Options', 'Result'];
const STATUS = { uploaded: 'Not started', queued: 'Waiting', running: 'Running', done: 'Finished', failed: 'Failed', cancelled: 'Cancelled' };

function Counts({ job }) {
  const dry = job.dryRun;
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Chip color="success" label={`${job.counts.created} ${dry ? 'would be added' : 'added'}`} />
      <Chip color="info" label={`${job.counts.updated} ${dry ? 'would be updated' : 'updated'}`} />
      <Chip label={`${job.counts.skipped} skipped`} />
      <Chip color={job.counts.failed ? 'error' : 'default'} label={`${job.counts.failed} with problems`} />
    </Stack>
  );
}

function Recent({ dataformId, onOpen }) {
  const { data = [] } = useListImportsQuery(dataformId);
  if (!data.length) return null;
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Recent imports</Typography>
      <Stack spacing={0.5}>
        {data.slice(0, 5).map((j) => (
          <Stack key={j._id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{j.filename}</Typography>
            <Typography variant="caption" color="text.secondary">{dayjs(j.createdAt).fromNow()}</Typography>
            <Chip size="small" label={j.dryRun && j.status === 'done' ? 'Checked' : STATUS[j.status]} />
            {j.status !== 'uploaded' && <Button size="small" onClick={() => onOpen(j._id)}>Details</Button>}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export default function ImportDialog({ open, dataform, onClose }) {
  const dispatch = useDispatch();
  const input = useRef(null);
  const [step, setStep] = useState(0);
  const [upload, uploading] = useUploadImportMutation();
  const [start, starting] = useStartImportMutation();
  const [cancel] = useCancelImportMutation();
  const [job, setJob] = useState(null);
  const [fields, setFields] = useState([]);
  const [mapping, setMapping] = useState({});
  const [opts, setOpts] = useState({ duplicate: 'skip', matchField: '', dateFormat: 'iso' });
  const [jobId, setJobId] = useState(null);

  const { data: live, refetch } = useGetImportQuery(jobId, { skip: !jobId });
  const current = live?.import;
  const settled = isSettled(current);
  usePoll(refetch, !!jobId && !settled);
  useEffect(() => {
    if (current && settled && !current.dryRun && current.status === 'done') dispatch(api.util.invalidateTags([{ type: 'Records', id: dataform._id }]));
  }, [current?.status, current?.dryRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setStep(0); setJob(null); setFields([]); setMapping({}); setJobId(null); setOpts({ duplicate: 'skip', matchField: '', dateFormat: 'iso' }); };
  const close = () => { reset(); onClose(); };
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const chosen = Object.entries(mapping).filter(([, k]) => k).map(([col, field]) => ({ column: Number(col), field }));
  const mapped = new Set(chosen.map((m) => m.field));
  const missing = fields.filter((f) => f.required && !mapped.has(f.key));
  const hasDates = chosen.some((m) => ['date', 'datetime'].includes(byKey.get(m.field)?.type));

  const pick = async (file) => {
    if (!file) return;
    try {
      const res = await upload({ dataformId: dataform._id, file }).unwrap();
      setJob(res.import); setFields(res.fields);
      setMapping(Object.fromEntries(res.suggestedMapping.map((m) => [m.column, m.field])));
      setStep(1);
    } catch (err) { dispatch(showToast(errorMessage(err, 'Could not read that file'), 'error')); }
  };
  const setField = (col, key) => setMapping((m) => {
    const next = { ...m };
    for (const c of Object.keys(next)) if (key && next[c] === key) delete next[c]; // a field can only come from one column
    if (key) next[col] = key; else delete next[col];
    return next;
  });
  const run = async (dryRun) => {
    try {
      await start({ id: job._id, mapping: chosen, duplicate: opts.duplicate, matchField: opts.matchField || undefined, dateFormat: opts.dateFormat, dryRun }).unwrap();
      setJobId(job._id); setStep(3);
    } catch (err) { dispatch(showToast(errorMessage(err, 'Could not start the import'), 'error')); }
  };
  const openExisting = (id) => { setJobId(id); setStep(3); };

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>Import into {dataform.name}</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3, display: { xs: 'none', sm: 'flex' } }}>{STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}</Stepper>

        {step === 0 && (
          <Box>
            <Box
              role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
              sx={{ border: '2px dashed', borderColor: 'divider', borderRadius: 2, p: 5, textAlign: 'center', cursor: 'pointer', '&:hover,&:focus-visible': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}
            >
              <UploadIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
              <Typography sx={{ mt: 1 }}>{uploading.isLoading ? 'Reading file…' : 'Drop a CSV file here, or click to choose one'}</Typography>
              <Typography variant="body2" color="text.secondary">The first row must be column headings. Up to 20,000 rows and 10 MB.</Typography>
              <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" hidden data-testid="import-file" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            </Box>
            <Recent dataformId={dataform._id} onOpen={openExisting} />
          </Box>
        )}

        {step === 1 && job && (
          <Box>
            <Typography color="text.secondary" sx={{ mb: 2 }}>{job.filename}: {job.rowCount.toLocaleString()} rows. Choose which field each column fills. Columns left on “Don’t import” are ignored.</Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>Column in your file</TableCell><TableCell>First rows</TableCell><TableCell sx={{ minWidth: 220 }}>Goes into</TableCell></TableRow></TableHead>
                <TableBody>
                  {job.headers.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ fontWeight: 600 }}>{h}</TableCell>
                      <TableCell sx={{ color: 'text.secondary', maxWidth: 260 }}><Typography variant="body2" noWrap>{job.sample.map((r) => r[i]).filter(Boolean).slice(0, 3).join(' · ')}</Typography></TableCell>
                      <TableCell>
                        <TextField select size="small" fullWidth value={mapping[i] ?? ''} onChange={(e) => setField(i, e.target.value)} slotProps={{ htmlInput: { 'aria-label': `Field for column ${h}` }, select: { displayEmpty: true } }}>
                          <MenuItem value=""><em>Don’t import</em></MenuItem>
                          {fields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</MenuItem>)}
                        </TextField>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            {missing.length > 0 && <Alert severity="warning" sx={{ mt: 2 }}>Still needed: {missing.map((f) => f.label).join(', ')} (required fields without a default value).</Alert>}
          </Box>
        )}

        {step === 2 && (
          <Stack spacing={2.5}>
            <TextField select label="Find existing records by" value={opts.matchField} onChange={(e) => setOpts({ ...opts, matchField: e.target.value })} helperText="Optional. If a row has the same value as a record that already exists, the setting below decides what happens.">
              <MenuItem value=""><em>Don’t look for existing records. Add every row.</em></MenuItem>
              {chosen.map((m) => <MenuItem key={m.field} value={m.field}>{byKey.get(m.field)?.label}</MenuItem>)}
            </TextField>
            <TextField select label="When a row matches an existing record" value={opts.duplicate} disabled={!opts.matchField} onChange={(e) => setOpts({ ...opts, duplicate: e.target.value })}>
              <MenuItem value="skip">Skip the row</MenuItem><MenuItem value="update">Update the existing record (blank cells are left alone)</MenuItem><MenuItem value="error">Report it as a problem</MenuItem>
            </TextField>
            {hasDates && (
              <TextField select label="Dates in your file look like" value={opts.dateFormat} onChange={(e) => setOpts({ ...opts, dateFormat: e.target.value })} helperText="Times without a time zone are treated as UTC.">
                <MenuItem value="iso">2024-03-31 (year-month-day)</MenuItem><MenuItem value="dmy">31/03/2024 (day/month/year)</MenuItem><MenuItem value="mdy">03/31/2024 (month/day/year)</MenuItem>
              </TextField>
            )}
            <Alert severity="info">Rules you set up under Automation, and webhooks, run for every imported row, just as if the record had been typed in. “Check file” tests every row without saving anything and does not run those rules.</Alert>
          </Stack>
        )}

        {step === 3 && !current && <LinearProgress />}
        {step === 3 && current && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>{current.filename}</Typography>
              <Chip color={current.status === 'done' ? 'success' : current.status === 'failed' ? 'error' : 'default'} label={current.dryRun && current.status === 'done' ? 'Check finished' : STATUS[current.status]} />
            </Stack>
            {!settled && (
              <Box>
                <LinearProgress variant={current.rowCount ? 'determinate' : 'indeterminate'} value={current.rowCount ? (current.processed / current.rowCount) * 100 : 0} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite">{current.processed.toLocaleString()} of {current.rowCount.toLocaleString()} rows</Typography>
              </Box>
            )}
            <Counts job={current} />
            {current.status === 'failed' && <Alert severity="error">The import stopped: {current.failure || 'an unexpected error occurred'}. Rows before this point were saved.</Alert>}
            {current.status === 'done' && current.dryRun && <Alert severity={current.counts.failed ? 'warning' : 'success'}>{current.counts.failed ? 'Some rows have problems. Nothing was saved. You can fix the file, or import anyway: rows with problems are skipped.' : 'Every row looks good. Nothing has been saved yet.'}</Alert>}
            {current.status === 'done' && !current.dryRun && <Alert severity={current.counts.failed ? 'warning' : 'success'}>Import finished. {current.counts.failed ? 'Rows with problems were not imported.' : ''}</Alert>}
            {current.errors?.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Problems{current.counts.failed > current.errors.length ? ` (first ${current.errors.length} of ${current.counts.failed})` : ''}</Typography>
                <Box sx={{ maxHeight: 220, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  <Table size="small"><TableBody>{current.errors.slice(0, 50).map((e) => <TableRow key={e.row}><TableCell sx={{ width: 80 }}>Row {e.row}</TableCell><TableCell>{e.message}</TableCell></TableRow>)}</TableBody></Table>
                </Box>
                {current.hasErrorsFile && <Button sx={{ mt: 1 }} onClick={() => downloadFile(store, `/imports/${current._id}/errors`, undefined, 'import-errors.csv', 'GET').catch((err) => dispatch(showToast(err.message, 'error')))}>Download rows with problems (CSV)</Button>}
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {step === 3 && current && !settled && <Button color="error" onClick={() => cancel(current._id)}>Stop import</Button>}
        {step === 3 && current?.dryRun && settled && job && <Button onClick={() => { setJobId(null); setStep(2); }}>Back to options</Button>}
        {step === 3 && current?.dryRun && settled && job && <Button variant="contained" disabled={starting.isLoading} onClick={() => run(false)}>Import now</Button>}
        {step === 2 && <Button color="inherit" onClick={() => setStep(1)}>Back</Button>}
        {step === 2 && <Button disabled={starting.isLoading} onClick={() => run(true)}>Check file first</Button>}
        {step === 2 && <Button variant="contained" disabled={starting.isLoading} onClick={() => run(false)}>Import {job?.rowCount.toLocaleString()} rows</Button>}
        {step === 1 && <Button color="inherit" onClick={reset}>Choose another file</Button>}
        {step === 1 && <Button variant="contained" disabled={chosen.length === 0 || missing.length > 0} onClick={() => setStep(2)}>Next</Button>}
        <Button color="inherit" onClick={close}>{step === 3 && settled ? 'Done' : 'Close'}</Button>
      </DialogActions>
    </Dialog>
  );
}

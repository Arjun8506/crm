import { useState } from 'react';
import usePoll from './usePoll';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { errorMessage } from '../../services/api';
import { store } from '../../app/store';
import { downloadFile } from '../../services/download';
import { showToast } from '../ui/uiSlice';
import { isSettled, useCreateExportMutation, useGetExportQuery, useListExportsQuery } from './dataopsApi';

dayjs.extend(relativeTime);
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Job({ id }) {
  const dispatch = useDispatch();
  const { data: job, refetch } = useGetExportQuery(id);
  usePoll(refetch, !isSettled(job));
  if (!job) return <LinearProgress />;
  const settled = isSettled(job);
  const download = () => downloadFile(store, `/exports/${job._id}/download`, undefined, job.filename ?? 'export', 'GET').catch((err) => dispatch(showToast(err.message, 'error')));
  return (
    <Stack spacing={1.5}>
      {!settled && <Box><LinearProgress /><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite">Preparing your file. You can close this window; we will notify you when it is ready.</Typography></Box>}
      {job.status === 'done' && <Alert severity="success" action={<Button color="inherit" size="small" onClick={download}>Download</Button>}>{job.rowCount.toLocaleString()} records{job.fileCount ? `, ${job.fileCount} files` : ''} · {size(job.size)} · available for 3 days</Alert>}
      {job.status === 'done' && job.warnings?.map((w) => <Alert key={w} severity="warning">{w}</Alert>)}
      {job.status === 'failed' && <Alert severity="error">The export failed: {job.failure || 'unexpected error'}</Alert>}
    </Stack>
  );
}

export default function ExportDialog({ open, dataform, params, onClose }) {
  const dispatch = useDispatch();
  const [format, setFormat] = useState('csv');
  const [create, creating] = useCreateExportMutation();
  const [jobId, setJobId] = useState(null);
  const { data: recent = [] } = useListExportsQuery(dataform._id, { skip: !open });
  const start = async () => {
    try { setJobId((await create({ dataformId: dataform._id, format, ...params }).unwrap()).export._id); } catch (err) { dispatch(showToast(errorMessage(err, 'Could not start the export'), 'error')); }
  };
  const close = () => { setJobId(null); onClose(); };
  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Export {dataform.name}</DialogTitle>
      <DialogContent>
        {jobId ? <Job id={jobId} /> : (
          <Stack spacing={2}>
            <Typography color="text.secondary">Exports the records matching your current search, filters and sort, with the columns you can see in the list. Large exports are prepared in the background.</Typography>
            <RadioGroup value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Format">
              <FormControlLabel value="csv" control={<Radio />} label="CSV file (opens in Excel, Numbers and Google Sheets)" />
              <FormControlLabel value="zip" control={<Radio />} label="ZIP: the CSV plus every file attached to those records" />
            </RadioGroup>
            {recent.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Your recent exports</Typography>
                <Stack spacing={0.5}>
                  {recent.slice(0, 4).map((j) => (
                    <Stack key={j._id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ flex: 1 }}>{j.format.toUpperCase()} · {dayjs(j.createdAt).fromNow()}</Typography>
                      <Chip size="small" label={j.status === 'done' ? 'Ready' : j.status === 'failed' ? 'Failed' : 'Preparing'} color={j.status === 'done' ? 'success' : j.status === 'failed' ? 'error' : 'default'} />
                      {j.status === 'done' && <Button size="small" onClick={() => downloadFile(store, `/exports/${j._id}/download`, undefined, j.filename ?? 'export', 'GET').catch((err) => dispatch(showToast(err.message, 'error')))}>Download</Button>}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={close}>{jobId ? 'Close' : 'Cancel'}</Button>
        {!jobId && <Button variant="contained" disabled={creating.isLoading} onClick={start}>Start export</Button>}
      </DialogActions>
    </Dialog>
  );
}

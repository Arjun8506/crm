import { useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Drawer, IconButton, MenuItem, Pagination, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { useGetExecutionQuery, useListExecutionsQuery, useRetryExecutionMutation } from './automationApi';

const COLORS = { succeeded: 'success', partial: 'warning', failed: 'error', blocked: 'warning', skipped: 'default', cancelled: 'default', queued: 'info', running: 'info' };
const EVENTS = { create: 'Record created', update: 'Record updated', delete: 'Record deleted', manual: 'Run manually', schedule: 'Scheduled' };
export const StatusChip = ({ status }) => <Chip size="small" color={COLORS[status] ?? 'default'} variant={['skipped', 'cancelled'].includes(status) ? 'outlined' : 'filled'} label={status} />;

function Detail({ id, onClose }) {
  const dispatch = useDispatch();
  const { data: e, isLoading, error } = useGetExecutionQuery(id);
  const [retry, { isLoading: retrying }] = useRetryExecutionMutation();
  return (
    <Drawer anchor="right" open onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 } } } }}>
      <Stack direction="row" sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ flex: 1 }}>Run details</Typography>
        <IconButton aria-label="Close" onClick={onClose}><CloseIcon /></IconButton>
      </Stack>
      {error ? <Box sx={{ p: 3 }}><ErrorState message={errorMessage(error)} /></Box> : isLoading || !e ? <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={200} /></Box> : (
        <Stack spacing={2} sx={{ p: 3, overflowY: 'auto' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <StatusChip status={e.status} />
            <Typography variant="body2">{EVENTS[e.event] ?? e.event} · {dayjs(e.createdAt).format('MMM D, YYYY h:mm:ss A')}</Typography>
          </Stack>
          {e.error && <Alert severity={e.status === 'blocked' ? 'warning' : e.status === 'skipped' || e.status === 'cancelled' ? 'info' : 'error'}>{e.error}</Alert>}
          <Typography variant="body2" color="text.secondary">{e.attempts} attempt{e.attempts === 1 ? '' : 's'} · loop depth {e.depth}{e.conditionsMatched === false ? ' · conditions did not match' : ''}</Typography>
          <Divider />
          <Typography variant="subtitle2">Actions</Typography>
          {e.actions.length === 0 ? <Typography variant="body2" color="text.secondary">No actions ran.</Typography> : e.actions.map((a) => (
            <Stack key={a.index} direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Chip size="small" label={a.index + 1} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight={600}>{a.type.replace(/_/g, ' ')}</Typography>
                <Typography variant="body2" color={a.status === 'failed' ? 'error' : 'text.secondary'}>{a.detail}</Typography>
              </Box>
              <Chip size="small" variant="outlined" color={a.status === 'failed' ? 'error' : a.status === 'ok' ? 'success' : 'default'} label={a.status} />
            </Stack>
          ))}
          {['failed', 'partial'].includes(e.status) && (
            <Button variant="contained" disabled={retrying} sx={{ alignSelf: 'flex-start' }}
              onClick={async () => { try { await retry(id).unwrap(); dispatch(showToast('The run was queued again. Finished steps are not repeated.')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }}>Retry from the failed step</Button>
          )}
          {e.snapshot && (
            <>
              <Divider />
              <Typography variant="subtitle2">Record when this ran</Typography>
              <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1.5, fontSize: 12, overflow: 'auto', maxHeight: 280 }}>{JSON.stringify(e.snapshot.after ?? e.snapshot.before, null, 2)}</Box>
            </>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

export default function ExecutionsPanel({ workflowId }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, isLoading, error, refetch } = useListExecutionsQuery({ id: workflowId, page, limit: 15, ...(status ? { status } : {}) });
  return (
    <Stack spacing={2}>
      <TextField select size="small" label="Show" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ width: 200 }}>
        <MenuItem value="">All runs</MenuItem>
        {Object.keys(COLORS).map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
      </TextField>
      {error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : isLoading ? <Skeleton variant="rounded" height={160} /> : !data.data.length ? (
        <EmptyState title="No runs yet" description="Runs appear here when the trigger fires and the conditions match." />
      ) : (
        <TableContainer>
          <Table size="small" sx={{ '& td, & th': { py: 1 } }}>
            <TableHead><TableRow><TableCell>When</TableCell><TableCell>Trigger</TableCell><TableCell>Status</TableCell><TableCell>Result</TableCell></TableRow></TableHead>
            <TableBody>
              {data.data.map((r) => (
                <TableRow key={r._id} hover sx={{ cursor: 'pointer' }} tabIndex={0} onClick={() => setOpen(r._id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r._id)}>
                  <TableCell>{dayjs(r.createdAt).format('MMM D, h:mm:ss A')}</TableCell>
                  <TableCell>{EVENTS[r.event] ?? r.event}</TableCell>
                  <TableCell><StatusChip status={r.status} /></TableCell>
                  <TableCell sx={{ maxWidth: 360 }}><Typography variant="body2" noWrap color={r.status === 'failed' ? 'error' : 'text.secondary'}>{r.error || `${r.actions.filter((a) => a.status === 'ok').length} of ${r.actions.length} actions completed`}</Typography></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.total > 15 && <Stack sx={{ p: 2, alignItems: 'center' }}><Pagination count={Math.ceil(data.total / 15)} page={page} onChange={(_e, p) => setPage(p)} /></Stack>}
        </TableContainer>
      )}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </Stack>
  );
}

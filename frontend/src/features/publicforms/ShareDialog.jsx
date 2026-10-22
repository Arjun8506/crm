import { useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import CopyIcon from '@mui/icons-material/ContentCopyRounded';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { useCreateShareMutation, useListSharesQuery, useRevokeShareMutation } from '../dataops/dataopsApi';

export default function ShareDialog({ open, dataform, fields, recordId, onClose }) {
  const dispatch = useDispatch();
  const offered = fields.filter((f) => f.visibility.list && f.type !== 'relationship');
  const [picked, setPicked] = useState(() => offered.slice(0, 3).map((f) => f.key));
  const [days, setDays] = useState(7);
  const [link, setLink] = useState(null);
  const { data: shares = [] } = useListSharesQuery({ dataformId: dataform._id, recordId }, { skip: !open });
  const [create, creating] = useCreateShareMutation();
  const [revoke] = useRevokeShareMutation();
  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const make = async () => {
    try { setLink((await create({ dataformId: dataform._id, recordId, fields: picked, expiresInDays: days }).unwrap()).url); } catch (err) { dispatch(showToast(errorMessage(err, 'Could not create the link'), 'error')); }
  };
  const close = () => { setLink(null); onClose(); };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Share this record</DialogTitle>
      <DialogContent>
        {link ? (
          <Stack spacing={2}>
            <Alert severity="warning">Copy the link now. It is not stored in a readable form, so it cannot be shown again. You can create another or withdraw this one at any time.</Alert>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField size="small" fullWidth value={link} slotProps={{ input: { readOnly: true, sx: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 } }, htmlInput: { 'aria-label': 'Share link' } }} />
              <Tooltip title="Copy link"><IconButton aria-label="Copy share link" onClick={async () => { await navigator.clipboard?.writeText(link); dispatch(showToast('Link copied')); }}><CopyIcon fontSize="small" /></IconButton></Tooltip>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Typography color="text.secondary">Anyone with the link can view the fields you choose, read-only, without signing in. Nothing else about the record is visible.</Typography>
            <Box>
              <Typography variant="subtitle2">Fields to show</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                {offered.map((f) => <FormControlLabel key={f.key} control={<Checkbox size="small" checked={picked.includes(f.key)} onChange={() => toggle(f.key)} />} label={f.label} />)}
              </Box>
            </Box>
            <TextField select label="Link works for" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <MenuItem value={1}>1 day</MenuItem><MenuItem value={7}>7 days</MenuItem><MenuItem value={30}>30 days</MenuItem><MenuItem value={90}>90 days</MenuItem>
            </TextField>
            {shares.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Links already created</Typography>
                <Stack spacing={0.5}>
                  {shares.map((s) => (
                    <Stack key={s._id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ flex: 1 }}>{s.fields.length} fields · {s.viewCount} view{s.viewCount === 1 ? '' : 's'} · {s.active ? `until ${dayjs(s.expiresAt).format('D MMM')}` : s.revokedAt ? 'withdrawn' : 'expired'}</Typography>
                      {s.active ? <Button size="small" color="error" onClick={() => revoke({ dataformId: dataform._id, recordId, shareId: s._id }).then(() => dispatch(showToast('Link withdrawn')))}>Withdraw</Button> : <Chip size="small" label="Inactive" />}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={close}>{link ? 'Done' : 'Cancel'}</Button>
        {!link && <Button variant="contained" disabled={creating.isLoading || picked.length === 0} onClick={make}>Create link</Button>}
      </DialogActions>
    </Dialog>
  );
}

import { useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, ListItemIcon, Menu, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import BookmarkIcon from '@mui/icons-material/BookmarkBorderRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import PeopleIcon from '@mui/icons-material/PeopleOutlineRounded';
import { ConfirmDialog } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { useCreateViewMutation, useDeleteViewMutation, useListViewsQuery, useUpdateViewMutation } from './viewsApi';

// Saved personal / shared views: a layout plus its search, filter, sort and display options.
export default function ViewsToolbar({ dataformId, canShare, snapshot, activeId, onApply, onClear }) {
  const dispatch = useDispatch();
  const { data: views = [] } = useListViewsQuery(dataformId);
  const [create, createState] = useCreateViewMutation();
  const [update, updateState] = useUpdateViewMutation();
  const [remove, removeState] = useDeleteViewMutation();
  const [anchor, setAnchor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = views.find((v) => v._id === activeId);

  const run = async (fn, ok) => {
    try { const res = await fn().unwrap(); dispatch(showToast(ok)); return res; } catch (err) { dispatch(showToast(errorMessage(err, 'Could not save the view'), 'error')); return null; }
  };

  const save = async (e) => {
    e.preventDefault();
    const { type, config } = snapshot();
    const res = await run(() => create({ dataformId, name: name.trim(), type, shared, config }), 'View saved');
    if (res) { setSaving(false); setName(''); setShared(false); onApply(res.view, { silent: true }); }
  };

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button color="inherit" variant="outlined" startIcon={<BookmarkIcon />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu">
        {active ? active.name : 'Views'}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { minWidth: 240 } } }}>
        <MenuItem onClick={() => { setAnchor(null); onClear(); }} selected={!active}>Default view</MenuItem>
        {views.length > 0 && <Typography variant="overline" color="text.secondary" sx={{ px: 2, display: 'block' }}>Saved views</Typography>}
        {views.map((v) => (
          <MenuItem key={v._id} selected={v._id === activeId} onClick={() => { setAnchor(null); onApply(v); }}>
            <Box sx={{ flex: 1 }}>{v.name}</Box>
            {v.shared && <ListItemIcon sx={{ minWidth: 0, ml: 1 }}><PeopleIcon fontSize="small" titleAccess="Shared" /></ListItemIcon>}
          </MenuItem>
        ))}
      </Menu>
      <Button size="small" onClick={() => setSaving(true)}>Save as view</Button>
      {active?.mine && (
        <>
          <Button size="small" disabled={updateState.isLoading} onClick={() => { const { type, config } = snapshot(); run(() => update({ dataformId, viewId: active._id, name: active.name, type, shared: active.shared, config }), 'View updated'); }}>Update view</Button>
          <Tooltip title="Delete view"><IconButton size="small" aria-label="Delete view" onClick={() => setConfirmDelete(true)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
        </>
      )}
      <Dialog open={saving} onClose={() => setSaving(false)} maxWidth="xs" fullWidth>
        <form onSubmit={save} noValidate>
          <DialogTitle>Save current view</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <TextField autoFocus label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
              <Typography variant="body2" color="text.secondary">Saves the layout, search, filters, sort and display options as they are now.</Typography>
              {canShare && <FormControlLabel control={<Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} />} label="Share with everyone who can open this dataform" />}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button color="inherit" onClick={() => setSaving(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={!name.trim() || createState.isLoading}>Save view</Button>
          </DialogActions>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete} destructive loading={removeState.isLoading} title={`Delete “${active?.name}”?`} confirmLabel="Delete view"
        message="Only the saved view is removed. No records are affected." onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { if (await run(() => remove({ dataformId, viewId: active._id }), 'View deleted')) { setConfirmDelete(false); onClear(); } }}
      />
    </Stack>
  );
}

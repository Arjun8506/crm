import { useEffect } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDispatch } from 'react-redux';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { useCreateWorkspaceMutation, useUpdateWorkspaceMutation } from './workspacesApi';

const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#475569'];
const schema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  description: z.string().trim().max(500),
  color: z.string(),
  visibility: z.enum(['account', 'private']),
});
const blank = { name: '', description: '', color: COLORS[0], visibility: 'account' };

export default function WorkspaceFormDialog({ open, workspace, onClose, onSaved }) {
  const dispatch = useDispatch();
  const [create, createState] = useCreateWorkspaceMutation();
  const [update, updateState] = useUpdateWorkspaceMutation();
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: blank });
  const color = useWatch({ control, name: 'color' });
  const saving = createState.isLoading || updateState.isLoading;

  useEffect(() => {
    if (open) reset(workspace ? { name: workspace.name, description: workspace.description, color: workspace.color, visibility: workspace.visibility } : blank);
  }, [open, workspace, reset]);

  const onSubmit = async (values) => {
    try {
      const res = workspace ? await update({ id: workspace._id, ...values }).unwrap() : await create(values).unwrap();
      dispatch(showToast(workspace ? 'Workspace updated' : 'Workspace created'));
      onSaved?.(res.workspace);
      onClose();
    } catch (err) {
      dispatch(showToast(errorMessage(err), 'error'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <DialogTitle>{workspace ? 'Edit workspace' : 'New workspace'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField label="Name" autoFocus {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
            <TextField label="Description" multiline minRows={2} {...register('description')} error={!!errors.description} helperText={errors.description?.message} />
            <Controller
              name="visibility" control={control}
              render={({ field }) => (
                <TextField select label="Visibility" {...field} helperText="Private workspaces are visible only to their members and account admins">
                  <MenuItem value="account">Everyone in the organization</MenuItem>
                  <MenuItem value="private">Private</MenuItem>
                </TextField>
              )}
            />
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Color</Typography>
              <Stack direction="row" spacing={1} role="radiogroup" aria-label="Workspace color">
                <Controller
                  name="color" control={control}
                  render={({ field }) => COLORS.map((c) => (
                    <Box
                      key={c} role="radio" aria-checked={color === c} aria-label={c} tabIndex={0}
                      onClick={() => field.onChange(c)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && field.onChange(c)}
                      sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: c, cursor: 'pointer', outline: color === c ? '2px solid' : 'none', outlineColor: 'text.primary', outlineOffset: 2 }}
                    />
                  ))}
                />
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{workspace ? 'Save changes' : 'Create workspace'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

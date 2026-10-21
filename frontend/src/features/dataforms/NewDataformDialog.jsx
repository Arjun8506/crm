import { useState } from 'react';
import { Button, Card, CardActionArea, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { useCreateDataformMutation, useGetTypesQuery } from './dataformsApi';

const BLANK = { id: '', name: 'Blank dataform', description: 'Start from scratch and add your own fields.', fieldCount: 0 };

export default function NewDataformDialog({ open, workspaceId, onClose }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { data } = useGetTypesQuery();
  const [create, { isLoading }] = useCreateDataformMutation();
  const [template, setTemplate] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const templates = [BLANK, ...(data?.templates ?? [])];

  const pick = (t) => {
    setTemplate(t.id);
    if (!nameTouched) setName(t.id ? t.name : '');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    try {
      const res = await create({ workspaceId, name: name.trim(), templateId: template || undefined }).unwrap();
      dispatch(showToast('Dataform created'));
      onClose();
      navigate(`/w/${workspaceId}/f/${res.dataform._id}${template ? '' : '/settings'}`);
    } catch (err) {
      dispatch(showToast(errorMessage(err, 'Could not create the dataform'), 'error'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>New dataform</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">Start from a ready-made form pack or a blank form.</Typography>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5 }}>
              {templates.map((t) => (
                <Card key={t.id} sx={{ width: 'calc(50% - 6px)', borderColor: template === t.id ? 'primary.main' : undefined, borderWidth: template === t.id ? 2 : 1 }}>
                  <CardActionArea onClick={() => pick(t)} sx={{ p: 1.5, height: '100%' }} aria-pressed={template === t.id}>
                    <Typography fontWeight={600}>{t.name}</Typography>
                    <Typography variant="body2" color="text.secondary">{t.description}</Typography>
                    {t.fieldCount > 0 && <Typography variant="caption" color="text.secondary">{t.fieldCount} fields</Typography>}
                  </CardActionArea>
                </Card>
              ))}
            </Stack>
            <TextField label="Name" required value={name} autoFocus onChange={(e) => { setName(e.target.value); setNameTouched(true); }} error={nameTouched && name.trim().length < 2} helperText={nameTouched && name.trim().length < 2 ? 'At least 2 characters' : undefined} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isLoading || name.trim().length < 2}>Create dataform</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

import { useState } from 'react';
import { Box, Button, Card, CardActionArea, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { selectCan } from '../auth/authSlice';
import { useNavigate } from 'react-router-dom';
import AddIcon from '@mui/icons-material/AddRounded';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import { EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { useCreateDashboardMutation, useListDashboardsQuery } from './analyticsApi';

function NewDashboardDialog({ canAccount, onClose }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [create, { isLoading }] = useCreateDashboardMutation();
  const [name, setName] = useState('');
  const [scope, setScope] = useState('user');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const res = await create({ name: name.trim(), scope, widgets: [] }).unwrap();
      dispatch(showToast('Dashboard created'));
      navigate(`/dashboards/${res.dashboard._id}`);
    } catch (err) {
      dispatch(showToast(errorMessage(err, 'Could not create the dashboard'), 'error'));
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>New dashboard</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField autoFocus required label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField select label="Who can see it" value={scope} onChange={(e) => setScope(e.target.value)}>
              <MenuItem value="user">Only me</MenuItem>
              <MenuItem value="account" disabled={!canAccount}>Everyone in the organization{canAccount ? '' : ' (admins only)'}</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!name.trim() || isLoading}>Create</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function DashboardsPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data = [], isLoading, error, refetch } = useListDashboardsQuery();
  const canAccount = useSelector(selectCan('account:update'));
  const newButton = <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>New dashboard</Button>;
  return (
    <PageTransition>
      <PageHeader title="Dashboards" description="Numbers, charts and lists across your workspaces. Organization dashboards are shared; personal ones are private." actions={newButton} />
      {error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>
          {isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} variant="rounded" height={120} />)}
          {data.map((d) => (
            <Card key={d._id}>
              <CardActionArea onClick={() => navigate(`/dashboards/${d._id}`)} sx={{ p: 2.5, height: '100%' }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <DashboardIcon color="primary" />
                  <Typography variant="h6" noWrap sx={{ flex: 1 }}>{d.name}</Typography>
                </Stack>
                <Chip size="small" variant="outlined" sx={{ mt: 1.5 }} label={d.scope === 'account' ? 'Organization' : 'Personal'} />
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}
      {!isLoading && !error && data.length === 0 && <EmptyState icon={<DashboardIcon />} title="No dashboards yet" description="Create one to track the numbers that matter." action={newButton} />}
      {open && <NewDashboardDialog canAccount={canAccount} onClose={() => setOpen(false)} />}
    </PageTransition>
  );
}

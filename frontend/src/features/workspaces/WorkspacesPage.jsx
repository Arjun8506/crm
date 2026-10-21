import { useState } from 'react';
import { Box, Button, Card, CardActionArea, Chip, IconButton, Menu, MenuItem, Skeleton, Stack, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import AddIcon from '@mui/icons-material/AddRounded';
import MoreIcon from '@mui/icons-material/MoreVertRounded';
import LockIcon from '@mui/icons-material/LockOutlined';
import GridIcon from '@mui/icons-material/GridViewRounded';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { selectCan } from '../auth/authSlice';
import { setCurrentWorkspace, showToast } from '../ui/uiSlice';
import WorkspaceFormDialog from './WorkspaceFormDialog';
import { useCloneWorkspaceMutation, useDeleteWorkspaceMutation, useListWorkspacesQuery } from './workspacesApi';

function WorkspaceCard({ ws, canCreate, onOpen, onEdit, onClone, onDelete, index }) {
  const [anchor, setAnchor] = useState(null);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.2) }} whileHover={{ y: -2 }} whileTap={{ scale: 0.99 }}>
      <Card sx={{ position: 'relative', height: '100%' }}>
        <Box sx={{ height: 4, bgcolor: ws.color }} />
        <CardActionArea onClick={onOpen} sx={{ p: 2.5, pb: 3, height: '100%', alignItems: 'flex-start' }}>
          <Stack spacing={1} sx={{ pr: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" noWrap>{ws.name}</Typography>
              {ws.visibility === 'private' && <LockIcon fontSize="small" color="disabled" titleAccess="Private" />}
            </Stack>
            <Typography color="text.secondary" variant="body2" sx={{ minHeight: 40 }}>{ws.description || 'No description'}</Typography>
            <Chip size="small" label={`${ws.members.length} member${ws.members.length === 1 ? '' : 's'}`} sx={{ alignSelf: 'flex-start' }} />
          </Stack>
        </CardActionArea>
        <IconButton size="small" aria-label={`Actions for ${ws.name}`} onClick={(e) => setAnchor(e.currentTarget)} sx={{ position: 'absolute', top: 14, right: 8 }}><MoreIcon /></IconButton>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
          <MenuItem onClick={() => { setAnchor(null); onEdit(); }}>Edit</MenuItem>
          {canCreate && <MenuItem onClick={() => { setAnchor(null); onClone(); }}>Clone</MenuItem>}
          <MenuItem sx={{ color: 'error.main' }} onClick={() => { setAnchor(null); onDelete(); }}>Delete</MenuItem>
        </Menu>
      </Card>
    </motion.div>
  );
}

export default function WorkspacesPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const canCreate = useSelector(selectCan('workspace:create'));
  const { data = [], isLoading, error, refetch } = useListWorkspacesQuery();
  const [clone] = useCloneWorkspaceMutation();
  const [remove, removeState] = useDeleteWorkspaceMutation();
  const [dialog, setDialog] = useState({ open: false, workspace: null });
  const [toDelete, setToDelete] = useState(null);

  const open = (ws) => { dispatch(setCurrentWorkspace(ws._id)); navigate(`/w/${ws._id}`); };
  const guard = async (fn, ok) => {
    try { await fn().unwrap(); dispatch(showToast(ok)); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  const newButton = canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, workspace: null })}>New workspace</Button>;

  return (
    <PageTransition>
      <PageHeader title="Workspaces" description="Organize your teams, projects and data into workspaces." actions={newButton} />
      {error ? <ErrorState message={errorMessage(error, 'Could not load workspaces')} onRetry={refetch} /> : (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', xl: 'repeat(4, 1fr)' } }}>
          {isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} variant="rounded" height={170} />)}
          {data.map((ws, i) => (
            <WorkspaceCard
              key={ws._id} ws={ws} index={i} canCreate={canCreate}
              onOpen={() => open(ws)} onEdit={() => setDialog({ open: true, workspace: ws })}
              onClone={() => guard(() => clone(ws._id), 'Workspace cloned')} onDelete={() => setToDelete(ws)}
            />
          ))}
        </Box>
      )}
      {!isLoading && !error && data.length === 0 && (
        <EmptyState icon={<GridIcon />} title="No workspaces yet" description="Create your first workspace to start organizing your work." action={newButton} />
      )}

      <WorkspaceFormDialog open={dialog.open} workspace={dialog.workspace} onClose={() => setDialog({ open: false, workspace: null })} />
      <ConfirmDialog
        open={!!toDelete} destructive loading={removeState.isLoading} confirmLabel="Delete workspace" title={`Delete “${toDelete?.name}”?`}
        message="This permanently removes the workspace and everything inside it. This cannot be undone."
        onClose={() => setToDelete(null)}
        onConfirm={async () => { await guard(() => remove(toDelete._id), 'Workspace deleted'); setToDelete(null); }}
      />
    </PageTransition>
  );
}

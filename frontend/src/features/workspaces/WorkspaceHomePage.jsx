import { useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarGroup, Box, Button, Card, CardActionArea, Chip, Skeleton, Stack, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import AddIcon from '@mui/icons-material/AddRounded';
import StorageIcon from '@mui/icons-material/TableChartOutlined';
import { EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { selectCan } from '../auth/authSlice';
import { setCurrentWorkspace } from '../ui/uiSlice';
import { useListMembersQuery } from '../accounts/accountApi';
import { useListDataformsQuery } from '../dataforms/dataformsApi';
import NewDataformDialog from '../dataforms/NewDataformDialog';
import { useListWorkspacesQuery } from './workspacesApi';

function DataformCard({ df, onOpen, index }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.2) }} whileHover={{ y: -2 }}>
      <Card sx={{ height: '100%' }}>
        <CardActionArea onClick={onOpen} sx={{ p: 2, height: '100%', alignItems: 'flex-start' }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap>{df.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40, mb: 1 }}>{df.description || 'No description'}</Typography>
          <Stack direction="row" spacing={1}>
            <Chip size="small" label={`${df.recordCount.toLocaleString()} record${df.recordCount === 1 ? '' : 's'}`} />
            <Chip size="small" variant="outlined" label={`${df.fieldCount} fields`} />
          </Stack>
        </CardActionArea>
      </Card>
    </motion.div>
  );
}

export default function WorkspaceHomePage() {
  const { workspaceId } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const me = useSelector((s) => s.auth.user);
  const isAccountAdmin = useSelector(selectCan('workspace:admin'));
  const [newOpen, setNewOpen] = useState(false);
  const { data: workspaces, isLoading, error, refetch } = useListWorkspacesQuery();
  const { data: members = [] } = useListMembersQuery();
  const ws = workspaces?.find((w) => w._id === workspaceId);
  const { data: dataforms = [], isLoading: formsLoading } = useListDataformsQuery({ workspaceId }, { skip: !ws });

  useEffect(() => { if (ws) dispatch(setCurrentWorkspace(ws._id)); }, [ws, dispatch]);
  const groups = useMemo(() => {
    const map = new Map();
    for (const d of dataforms) map.set(d.category || 'General', [...(map.get(d.category || 'General') ?? []), d]);
    return [...map.entries()];
  }, [dataforms]);

  if (isLoading) return <Skeleton variant="rounded" height={200} />;
  if (error) return <ErrorState message="Could not load workspace" onRetry={refetch} />;
  if (!ws) {
    return <EmptyState title="Workspace not found" description="It may have been deleted, or you may not have access." action={<Button component={RouterLink} to="/workspaces" variant="contained">Back to workspaces</Button>} />;
  }

  const canBuild = isAccountAdmin || ws.members.some((m) => m.user === me?._id && m.role === 'admin');
  const wsMembers = ws.members.map((m) => ({ ...m, info: members.find((x) => x.user._id === m.user)?.user })).filter((m) => m.info);
  const newButton = canBuild && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>New dataform</Button>;

  return (
    <PageTransition>
      <PageHeader
        title={ws.name} description={ws.description || 'No description'}
        actions={<>{<Chip label={ws.visibility === 'private' ? 'Private' : 'Organization-wide'} variant="outlined" />}{newButton}</>}
      />
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '3fr 1fr' }, alignItems: 'start' }}>
        <Stack spacing={3}>
          {formsLoading && <Skeleton variant="rounded" height={140} />}
          {!formsLoading && dataforms.length === 0 && (
            <Card sx={{ borderTop: 4, borderTopColor: ws.color }}>
              <EmptyState
                icon={<StorageIcon />} title="No dataforms yet"
                description={canBuild ? 'Dataforms hold your records. Start from a ready-made pack like Contacts or Deals, or build your own.' : 'A workspace admin can create dataforms here.'}
                action={newButton || undefined}
              />
            </Card>
          )}
          {groups.map(([category, list]) => (
            <Box key={category}>
              <Typography variant="overline" color="text.secondary">{category}</Typography>
              <Box sx={{ mt: 1, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' } }}>
                {list.map((d, i) => <DataformCard key={d._id} df={d} index={i} onOpen={() => navigate(`/w/${ws._id}/f/${d._id}`)} />)}
              </Box>
            </Box>
          ))}
        </Stack>
        <Card sx={{ p: 2.5 }}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>Members</Typography>
          <AvatarGroup max={6} sx={{ justifyContent: 'flex-end', mb: 2 }}>
            {wsMembers.map((m) => <Avatar key={m.user} alt={m.info.name} sx={{ bgcolor: 'primary.main' }}>{m.info.name[0]}</Avatar>)}
          </AvatarGroup>
          <Stack spacing={1.25}>
            {wsMembers.map((m) => (
              <Stack key={m.user} direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap fontWeight={500}>{m.info.name}</Typography>
                  <Typography noWrap variant="body2" color="text.secondary">{m.info.email}</Typography>
                </Box>
                <Chip size="small" label={m.role} />
              </Stack>
            ))}
          </Stack>
        </Card>
      </Box>
      {newOpen && <NewDataformDialog open workspaceId={ws._id} onClose={() => setNewOpen(false)} />}
    </PageTransition>
  );
}

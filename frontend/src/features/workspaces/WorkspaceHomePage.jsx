import { useEffect } from 'react';
import { Avatar, AvatarGroup, Box, Button, Card, Chip, Skeleton, Stack, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { Link as RouterLink, useParams } from 'react-router-dom';
import StorageIcon from '@mui/icons-material/TableChartOutlined';
import { EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { setCurrentWorkspace } from '../ui/uiSlice';
import { useListMembersQuery } from '../accounts/accountApi';
import { useListWorkspacesQuery } from './workspacesApi';

export default function WorkspaceHomePage() {
  const { workspaceId } = useParams();
  const dispatch = useDispatch();
  const { data: workspaces, isLoading, error, refetch } = useListWorkspacesQuery();
  const { data: members = [] } = useListMembersQuery();
  const ws = workspaces?.find((w) => w._id === workspaceId);

  useEffect(() => { if (ws) dispatch(setCurrentWorkspace(ws._id)); }, [ws, dispatch]);

  if (isLoading) return <Skeleton variant="rounded" height={200} />;
  if (error) return <ErrorState message="Could not load workspace" onRetry={refetch} />;
  if (!ws) {
    return <EmptyState title="Workspace not found" description="It may have been deleted, or you may not have access." action={<Button component={RouterLink} to="/workspaces" variant="contained">Back to workspaces</Button>} />;
  }

  const wsMembers = ws.members.map((m) => ({ ...m, info: members.find((x) => x.user._id === m.user)?.user })).filter((m) => m.info);

  return (
    <PageTransition>
      <PageHeader
        title={ws.name} description={ws.description || 'No description'}
        actions={<Chip label={ws.visibility === 'private' ? 'Private' : 'Organization-wide'} variant="outlined" />}
      />
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' } }}>
        <Card sx={{ borderTop: 4, borderTopColor: ws.color }}>
          <EmptyState
            icon={<StorageIcon />} title="No dataforms yet"
            description="Dataforms, custom fields and records are the next milestone (Phase 2). This workspace is ready and its access rules are already enforced."
          />
        </Card>
        <Card sx={{ p: 2.5 }}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>Members</Typography>
          <AvatarGroup max={6} sx={{ justifyContent: 'flex-end', mb: 2 }}>
            {wsMembers.map((m) => <Avatar key={m.user} alt={m.info.name} sx={{ bgcolor: 'primary.main' }}>{m.info.name[0]}</Avatar>)}
          </AvatarGroup>
          <Stack spacing={1.25}>
            {wsMembers.map((m) => (
              <Stack key={m.user} direction="row" justifyContent="space-between" alignItems="center">
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
    </PageTransition>
  );
}

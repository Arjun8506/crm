import { Avatar, Card, Chip, MenuItem, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { selectCan } from '../auth/authSlice';
import { showToast } from '../ui/uiSlice';
import { useListMembersQuery, useUpdateMemberMutation } from '../accounts/accountApi';

dayjs.extend(relativeTime);

export default function TeamPage() {
  const dispatch = useDispatch();
  const canManage = useSelector(selectCan('user:manage'));
  const me = useSelector((s) => s.auth.user);
  const { data = [], isLoading, error, refetch } = useListMembersQuery();
  const [update] = useUpdateMemberMutation();

  const change = async (id, body) => {
    try { await update({ id, ...body }).unwrap(); dispatch(showToast('Member updated')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };

  return (
    <PageTransition>
      <PageHeader title="Team & roles" description="People in your organization and what they can do." />
      {error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : (
        <Card>
          <TableContainer>
            <Table size="small" sx={{ '& td, & th': { py: 1.25 } }}>
              <TableHead>
                <TableRow><TableCell>Member</TableCell><TableCell>Role</TableCell><TableCell>Status</TableCell><TableCell>Last sign-in</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {isLoading && Array.from({ length: 4 }, (_, i) => <TableRow key={i}><TableCell colSpan={4}><Skeleton /></TableCell></TableRow>)}
                {data.map((m) => {
                  const editable = canManage && m.role !== 'owner' && m.user._id !== me?._id;
                  return (
                    <TableRow key={m.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                          <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>{m.user.name[0]}</Avatar>
                          <div><Typography fontWeight={500}>{m.user.name}</Typography><Typography variant="body2" color="text.secondary">{m.user.email}</Typography></div>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <TextField select size="small" value={m.role} onChange={(e) => change(m.id, { role: e.target.value })} slotProps={{ htmlInput: { 'aria-label': `Role for ${m.user.name}` } }} sx={{ minWidth: 120 }}>
                            {['admin', 'member', 'viewer'].map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                          </TextField>
                        ) : <Chip size="small" label={m.role} color={m.role === 'owner' ? 'primary' : 'default'} />}
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <TextField select size="small" value={m.status} onChange={(e) => change(m.id, { status: e.target.value })} slotProps={{ htmlInput: { 'aria-label': `Status for ${m.user.name}` } }} sx={{ minWidth: 120 }}>
                            <MenuItem value="active">active</MenuItem><MenuItem value="disabled">disabled</MenuItem>
                          </TextField>
                        ) : <Chip size="small" variant="outlined" label={m.status} />}
                      </TableCell>
                      <TableCell>{m.user.lastLoginAt ? dayjs(m.user.lastLoginAt).fromNow() : 'Never'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </PageTransition>
  );
}

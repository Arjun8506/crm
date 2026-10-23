import { useState } from 'react';
import { Alert, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Skeleton, Stack, Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import AddIcon from '@mui/icons-material/AddRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditIcon from '@mui/icons-material/EditOutlined';
import AutoIcon from '@mui/icons-material/AutoFixHighOutlined';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useGetDataformQuery, useListDataformsQuery } from '../dataforms/dataformsApi';
import { showToast } from '../ui/uiSlice';
import { SuggestWorkflowButton } from '../ai/AiAssist';
import { FieldChips } from './FormulaField';
import { useDeleteTemplateMutation, useListTemplatesQuery, useListWorkflowsQuery, useSaveTemplateMutation, useSetWorkflowEnabledMutation } from './automationApi';

dayjs.extend(relativeTime);
const TRIGGER = { pre_save: 'Before save', post_save: 'After save', pre_delete: 'Before delete', post_delete: 'After delete', manual: 'Manual', schedule: 'Scheduled' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function triggerSummary(t) {
  if (t.type === 'schedule') {
    const s = t.schedule;
    const when = s.frequency === 'hourly' ? `every hour at :${s.time.slice(3)}` : s.frequency === 'daily' ? `daily at ${s.time}` : s.frequency === 'weekly' ? `${WEEKDAYS[s.dayOfWeek]}s at ${s.time}` : `day ${s.dayOfMonth} of each month at ${s.time}`;
    return `${when} (${s.timezone})`;
  }
  if (t.events) return `${TRIGGER[t.type]}: ${t.events.join(' & ')}`;
  return TRIGGER[t.type];
}

function TemplateDialog({ template, workspaceId, dataforms, onClose }) {
  const dispatch = useDispatch();
  const [save, { isLoading }] = useSaveTemplateMutation();
  const [v, setV] = useState({ name: template?.name ?? '', channel: template?.channel ?? 'email', subject: template?.subject ?? '', body: template?.body ?? '' });
  const [dataformId, setDataformId] = useState(dataforms[0]?._id);
  const { data: meta } = useGetDataformQuery(dataformId, { skip: !dataformId });
  const submit = async (e) => {
    e.preventDefault();
    try { await save({ id: template?._id, workspaceId, ...v }).unwrap(); dispatch(showToast('Template saved')); onClose(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>{template ? 'Edit template' : 'New message template'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={2}>
              <TextField autoFocus required label="Name" fullWidth value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
              <TextField select label="Channel" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })} sx={{ minWidth: 140 }} disabled={!!template}>
                <MenuItem value="email">Email</MenuItem><MenuItem value="sms">SMS</MenuItem><MenuItem value="whatsapp">WhatsApp</MenuItem>
              </TextField>
            </Stack>
            {v.channel === 'email' && <TextField label="Subject" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />}
            <TextField required multiline minRows={5} label="Message" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} helperText="Variables such as {{name}} are filled in from the record when the message is sent." />
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <TextField select size="small" label="Insert fields from" value={dataformId ?? ''} onChange={(e) => setDataformId(e.target.value)} sx={{ minWidth: 200 }}>{dataforms.map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}</TextField>
            </Stack>
            <FieldChips fields={meta?.fields ?? []} wrap="{{}}" onInsert={(token) => setV((x) => ({ ...x, body: `${x.body}${token}` }))} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button color="inherit" onClick={onClose}>Cancel</Button><Button type="submit" variant="contained" disabled={isLoading || !v.name.trim() || !v.body.trim()}>Save template</Button></DialogActions>
      </form>
    </Dialog>
  );
}

function TemplatesTab({ workspaceId, dataforms }) {
  const dispatch = useDispatch();
  const { data = [], isLoading, error, refetch } = useListTemplatesQuery({ workspaceId });
  const [remove] = useDeleteTemplateMutation();
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  if (error) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
  return (
    <Card>
      <Stack direction="row" sx={{ p: 2, justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">Reusable messages for email, SMS and WhatsApp. Variables are filled in from the record.</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>New template</Button>
      </Stack>
      {isLoading ? <Skeleton variant="rounded" height={120} sx={{ m: 2 }} /> : data.length === 0 ? <EmptyState title="No templates yet" description="Create a template to speed up common emails and texts." /> : (
        <TableContainer>
          <Table size="small" sx={{ '& td, & th': { py: 1.25 } }}>
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Channel</TableCell><TableCell>Preview</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {data.map((t) => (
                <TableRow key={t._id} hover>
                  <TableCell><Typography fontWeight={500}>{t.name}</Typography></TableCell>
                  <TableCell><Chip size="small" label={t.channel} /></TableCell>
                  <TableCell sx={{ maxWidth: 380 }}><Typography variant="body2" color="text.secondary" noWrap>{t.subject ? `${t.subject}: ` : ''}{t.body}</Typography></TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" color="error" aria-label={`Delete ${t.name}`} onClick={() => setToDelete(t)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {editing && <TemplateDialog template={editing._id ? editing : null} workspaceId={workspaceId} dataforms={dataforms} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!toDelete} destructive title={`Delete “${toDelete?.name}”?`} confirmLabel="Delete template" message="Messages already sent are not affected." onClose={() => setToDelete(null)}
        onConfirm={async () => { try { await remove(toDelete._id).unwrap(); dispatch(showToast('Template deleted')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } setToDelete(null); }} />
    </Card>
  );
}

export default function WorkflowsPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [tab, setTab] = useState('workflows');
  const { data = [], isLoading, error, refetch } = useListWorkflowsQuery({ workspaceId });
  const { data: dataforms = [] } = useListDataformsQuery({ workspaceId });
  const [setEnabled] = useSetWorkflowEnabledMutation();
  const nameOf = (id) => dataforms.find((d) => d._id === id)?.name ?? '';
  const limited = data.length > 0 && data[0].actions === undefined; // editors only receive the manual workflows they can run
  const newButton = <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(`/w/${workspaceId}/workflows/new`)}>New workflow</Button>;
  const headerActions = <>{dataforms.length > 0 && <SuggestWorkflowButton workspaceId={workspaceId} dataforms={dataforms} />}{newButton}</>;

  return (
    <PageTransition>
      <PageHeader title="Automation" description="Workflows react to changes and schedules, and message templates keep communication consistent." actions={tab === 'workflows' && !limited ? headerActions : undefined} />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}><Tab value="workflows" label="Workflows" /><Tab value="templates" label="Message templates" /></Tabs>
      {tab === 'templates' ? <TemplatesTab workspaceId={workspaceId} dataforms={dataforms} /> : error ? (
        error.status === 403 ? <EmptyState icon={<AutoIcon />} title="Workflows are managed by workspace admins" description="Ask an admin to set one up. Manual workflows appear as Actions on records." /> : <ErrorState message={errorMessage(error)} onRetry={refetch} />
      ) : (
        <Card>
          {limited && <Alert severity="info" sx={{ m: 2 }}>You can run these from the Actions menu on a record. Only workspace admins can edit workflows.</Alert>}
          {isLoading ? <Skeleton variant="rounded" height={160} sx={{ m: 2 }} /> : data.length === 0 ? (
            <EmptyState icon={<AutoIcon />} title="No workflows yet" description="Automate follow-ups, enforce rules, and keep records in sync: for example, notify the team when a deal is won." action={newButton} />
          ) : (
            <TableContainer>
              <Table size="small" sx={{ '& td, & th': { py: 1.25 } }}>
                <TableHead><TableRow><TableCell>Workflow</TableCell><TableCell>Dataform</TableCell><TableCell>Runs</TableCell>{!limited && <TableCell>Last run</TableCell>}{!limited && <TableCell align="center">On</TableCell>}</TableRow></TableHead>
                <TableBody>
                  {data.map((w) => (
                    <TableRow key={w._id} hover={!limited} sx={{ cursor: limited ? 'default' : 'pointer' }} tabIndex={limited ? -1 : 0} onClick={() => !limited && navigate(`/w/${workspaceId}/workflows/${w._id}`)} onKeyDown={(e) => e.key === 'Enter' && !limited && navigate(`/w/${workspaceId}/workflows/${w._id}`)}>
                      <TableCell><Typography fontWeight={500}>{w.name}</Typography>{w.description && <Typography variant="caption" color="text.secondary">{w.description}</Typography>}</TableCell>
                      <TableCell>{nameOf(w.dataform)}</TableCell>
                      <TableCell><Typography variant="body2">{triggerSummary(w.trigger)}</Typography></TableCell>
                      {!limited && <TableCell><Typography variant="body2" color="text.secondary">{w.lastRunAt ? dayjs(w.lastRunAt).fromNow() : 'Never'}</Typography></TableCell>}
                      {!limited && (
                        <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                          <Switch checked={w.enabled} slotProps={{ input: { 'aria-label': `${w.name} is ${w.enabled ? 'on' : 'paused'}` } }}
                            onChange={async (e) => { try { await setEnabled({ id: w._id, enabled: e.target.checked }).unwrap(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}
    </PageTransition>
  );
}

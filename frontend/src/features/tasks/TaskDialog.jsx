import { useState } from 'react';
import { Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import { errorMessage } from '../../services/api';
import { useListMembersQuery } from '../accounts/accountApi';
import { useCreateTaskMutation, useUpdateTaskMutation } from '../collab/collabApi';
import { showToast } from '../ui/uiSlice';
import { useListWorkspacesQuery } from '../workspaces/workspacesApi';

const local = (iso) => (iso ? dayjs(iso).format('YYYY-MM-DDTHH:mm') : '');
const toIso = (v) => (v ? new Date(v).toISOString() : null);

export default function TaskDialog({ task, workspaceId, recordId, recordLabel, onClose, onSaved }) {
  const dispatch = useDispatch();
  const editing = !!task;
  const { data: workspaces = [] } = useListWorkspacesQuery();
  const { data: members = [] } = useListMembersQuery();
  const [create, createState] = useCreateTaskMutation();
  const [update, updateState] = useUpdateTaskMutation();
  const [ws, setWs] = useState(workspaceId ?? '');
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assignees, setAssignees] = useState(() => (task?.assignees ?? []).map((a) => a._id));
  const [priority, setPriority] = useState(task?.priority ?? 'normal');
  const [status, setStatus] = useState(task?.status ?? 'todo');
  const [due, setDue] = useState(local(task?.due));
  const [reminder, setReminder] = useState(local(task?.reminderAt));
  const [touched, setTouched] = useState(false);
  const people = members.filter((m) => m.status === 'active').map((m) => m.user);
  const wsId = ws || workspaces[0]?._id || '';
  const reminderAfterDue = due && reminder && new Date(reminder) > new Date(due);

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!title.trim() || !wsId) return;
    const body = { title: title.trim(), description, assignees, priority, status, due: toIso(due), reminderAt: toIso(reminder) };
    try {
      const res = editing ? await update({ id: task._id, ...body }).unwrap() : await create({ workspaceId: wsId, ...(recordId ? { recordId } : {}), ...body }).unwrap();
      dispatch(showToast(editing ? 'Task updated' : 'Task created'));
      onSaved?.(res.task);
      onClose();
    } catch (err) {
      dispatch(showToast(errorMessage(err, 'Could not save the task'), 'error'));
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>{editing ? 'Edit task' : 'New task'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField autoFocus required label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={touched && !title.trim()} helperText={touched && !title.trim() ? 'Enter a title' : undefined} />
            {!editing && !workspaceId && (
              <TextField select label="Workspace" value={wsId} onChange={(e) => setWs(e.target.value)}>
                {workspaces.map((w) => <MenuItem key={w._id} value={w._id}>{w.name}</MenuItem>)}
              </TextField>
            )}
            {recordLabel && <TextField label="Linked record" value={recordLabel} disabled />}
            <TextField label="Description" multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            <Autocomplete
              multiple options={people} getOptionLabel={(u) => u.name} isOptionEqualToValue={(a, b) => a._id === b._id}
              value={people.filter((u) => assignees.includes(u._id))} onChange={(_e, v) => setAssignees(v.map((u) => u._id))}
              renderInput={(p) => <TextField {...p} label="Assignees" helperText="Only people who can open this workspace can be assigned" />}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Priority" fullWidth value={priority} onChange={(e) => setPriority(e.target.value)}>
                {['low', 'normal', 'high', 'urgent'].map((p) => <MenuItem key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</MenuItem>)}
              </TextField>
              <TextField select label="Status" fullWidth value={status} onChange={(e) => setStatus(e.target.value)}>
                <MenuItem value="todo">To do</MenuItem><MenuItem value="in_progress">In progress</MenuItem><MenuItem value="done">Done</MenuItem>
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Due" type="datetime-local" fullWidth value={due} onChange={(e) => setDue(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="Remind me" type="datetime-local" fullWidth value={reminder} onChange={(e) => setReminder(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} error={!!reminderAfterDue} helperText={reminderAfterDue ? 'The reminder is after the due date' : 'Assignees are notified at this time'} />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={createState.isLoading || updateState.isLoading}>{editing ? 'Save task' : 'Create task'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

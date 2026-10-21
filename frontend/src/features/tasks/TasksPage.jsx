import { useMemo, useState } from 'react';
import { Button, Card, Tab, Tabs } from '@mui/material';
import { useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import AddIcon from '@mui/icons-material/AddRounded';
import { PageHeader, PageTransition } from '../../components/common';
import TaskDialog from './TaskDialog';
import TaskDrawer from './TaskDrawer';
import TaskList from './TaskList';

// My Tasks (everything assigned to me) when there is no workspace in the URL, otherwise that workspace's tasks.
export default function TasksPage() {
  const { workspaceId } = useParams();
  const [search, setSearch] = useSearchParams();
  const [tab, setTab] = useState(workspaceId ? 'open' : 'today');
  const [creating, setCreating] = useState(false);
  const taskId = search.get('task');

  // Day boundaries are computed in the user's local time zone and sent to the server as instants.
  const params = useMemo(() => {
    const today = dayjs().startOf('day');
    const base = workspaceId ? { scope: 'workspace', workspaceId } : { scope: 'mine' };
    switch (tab) {
      case 'overdue': return { ...base, status: 'open', dueTo: today.toISOString() };
      case 'today': return { ...base, status: 'open', dueFrom: today.toISOString(), dueTo: today.add(1, 'day').toISOString() };
      case 'upcoming': return { ...base, status: 'open', dueFrom: today.add(1, 'day').toISOString() };
      case 'nodate': return { ...base, status: 'open', noDue: 'true' };
      case 'done': return { ...base, status: 'done' };
      case 'all': return { ...base, status: 'all' };
      default: return { ...base, status: 'open' };
    }
  }, [tab, workspaceId]);

  const tabs = workspaceId
    ? [['open', 'Open'], ['overdue', 'Overdue'], ['done', 'Done'], ['all', 'All']]
    : [['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['nodate', 'No date'], ['done', 'Done']];
  const emptyFor = { overdue: 'Nothing is overdue.', today: 'Nothing due today.', upcoming: 'Nothing is scheduled.', nodate: 'Every open task has a date.', done: 'No completed tasks yet.' };

  return (
    <PageTransition>
      <PageHeader
        title={workspaceId ? 'Workspace tasks' : 'My tasks'} description={workspaceId ? 'Every task in this workspace.' : 'Tasks assigned to you across your workspaces.'}
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New task</Button>}
      />
      <Card>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}>
          {tabs.map(([v, l]) => <Tab key={v} value={v} label={l} />)}
        </Tabs>
        <TaskList key={tab} params={params} showWorkspaceTasks={!!workspaceId} onOpen={(id) => setSearch({ task: id })} emptyTitle="No tasks here" emptyText={emptyFor[tab]} />
      </Card>
      {creating && <TaskDialog workspaceId={workspaceId} onClose={() => setCreating(false)} />}
      {taskId && <TaskDrawer taskId={taskId} onClose={() => setSearch({})} />}
    </PageTransition>
  );
}

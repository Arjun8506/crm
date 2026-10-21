import { useState } from 'react';
import { Box, Button, Card, IconButton, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import AddIcon from '@mui/icons-material/AddRounded';
import ArrowBack from '@mui/icons-material/ArrowBackRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownIcon from '@mui/icons-material/ArrowDownwardRounded';
import EditIcon from '@mui/icons-material/EditOutlined';
import UpIcon from '@mui/icons-material/ArrowUpwardRounded';
import WidgetsIcon from '@mui/icons-material/WidgetsOutlined';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { CardValue } from '../views/CardsView';
import { showToast } from '../ui/uiSlice';
import { formatGroupKey, metricLabel, orderRows } from './AnalyzerPanel';
import { useDeleteDashboardMutation, useGetDashboardQuery, useSaveDashboardMutation, useWidgetDataQuery } from './analyticsApi';
import { ChartWidget, formatMetric } from './charts';
import WidgetDialog from './WidgetDialog';

const HEIGHT = { 1: 200, 2: 320 };

function ListBody({ data }) {
  return (
    <Table size="small" sx={{ '& td, & th': { py: 0.75 } }}>
      <TableHead><TableRow><TableCell>{data.dataform.name}</TableCell>{data.fields.map((f) => <TableCell key={f.key}>{f.label}</TableCell>)}</TableRow></TableHead>
      <TableBody>
        {data.rows.map((r) => (
          <TableRow key={r._id}>
            <TableCell><Typography variant="body2" fontWeight={500} noWrap>{r._label}</Typography></TableCell>
            {data.fields.map((f) => <TableCell key={f.key}><CardValue field={f} value={r.data?.[f.key]} refs={data.refs} /></TableCell>)}
          </TableRow>
        ))}
        {data.rows.length === 0 && <TableRow><TableCell colSpan={data.fields.length + 1}><Typography color="text.secondary" sx={{ textAlign: 'center' }}>No records</Typography></TableCell></TableRow>}
      </TableBody>
    </Table>
  );
}

function AnalyzerBody({ data }) {
  return (
    <Table size="small" sx={{ '& td, & th': { py: 0.75 } }}>
      <TableHead>
        <TableRow>
          {data.groups.map((g) => <TableCell key={g.field}>{g.label}</TableCell>)}
          {data.metrics.map((m) => <TableCell key={m.key} align="right">{metricLabel(m, data.fields)}</TableCell>)}
        </TableRow>
      </TableHead>
      <TableBody>
        {orderRows(data, data.fields).map((r) => (
          <TableRow key={JSON.stringify(r.keys)}>
            {data.groups.map((g, i) => <TableCell key={g.field}>{formatGroupKey(g, r.keys[i], data.refs, data.fields)}</TableCell>)}
            {data.metrics.map((m) => <TableCell key={m.key} align="right">{formatMetric(r.metrics[m.key])}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function WidgetBody({ dashboardId, widget }) {
  const unsaved = widget.id.startsWith('new_');
  const { data, error, isLoading, refetch } = useWidgetDataQuery({ dashboardId, widgetId: widget.id }, { skip: unsaved, refetchOnMountOrArgChange: true });
  if (unsaved) return <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Save the dashboard to preview this widget.</Typography>;
  if (error) return <ErrorState message={errorMessage(error, 'Could not load this widget')} onRetry={refetch} />;
  if (isLoading || !data) return <Skeleton variant="rounded" height={HEIGHT[widget.h] - 40} />;
  switch (data.type) {
    case 'kpi':
      return (
        <Box sx={{ py: 1 }}>
          <Typography sx={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>{formatMetric(data.value)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{data.metricLabel} · {data.dataform.name}</Typography>
        </Box>
      );
    case 'chart': return <ChartWidget result={data} fields={data.fields} height={HEIGHT[widget.h] - 56} />;
    case 'list': return <Box sx={{ overflow: 'auto', maxHeight: HEIGHT[widget.h] - 40 }}><ListBody data={data} /></Box>;
    case 'analyzer': return <Box sx={{ overflow: 'auto', maxHeight: HEIGHT[widget.h] - 40 }}><AnalyzerBody data={data} /></Box>;
    default: return null;
  }
}

export default function DashboardPage() {
  const { dashboardId } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { data, isLoading, error } = useGetDashboardQuery(dashboardId);
  const [save, saveState] = useSaveDashboardMutation();
  const [remove, removeState] = useDeleteDashboardMutation();
  const [draft, setDraft] = useState(null); // { name, widgets } while editing
  const [dialog, setDialog] = useState(null); // { widget? , index? }
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) return <Skeleton variant="rounded" height={300} />;
  if (error) return <EmptyState title="Dashboard not found" description="It may have been deleted, or it is private to someone else." action={<Button component={RouterLink} to="/dashboards">Back to dashboards</Button>} />;

  const { dashboard, editable } = data;
  const editing = !!draft;
  const widgets = editing ? draft.widgets : dashboard.widgets;
  const patch = (fn) => setDraft((d) => ({ ...d, widgets: fn(d.widgets) }));
  const move = (i, dir) => patch((ws) => { const n = [...ws]; const j = i + dir; if (j < 0 || j >= n.length) return ws; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const onSave = async () => {
    try {
      const body = { id: dashboardId, name: draft.name.trim() || dashboard.name, widgets: draft.widgets.map((w) => (w.id.startsWith('new_') ? (({ id: _id, ...rest }) => rest)(w) : w)) };
      await save(body).unwrap();
      setDraft(null);
      dispatch(showToast('Dashboard saved'));
    } catch (err) {
      dispatch(showToast(errorMessage(err, 'Could not save the dashboard'), 'error'));
    }
  };

  const actions = editing ? (
    <>
      <Button startIcon={<AddIcon />} onClick={() => setDialog({})}>Add widget</Button>
      <Button color="inherit" onClick={() => setDraft(null)}>Cancel</Button>
      <Button variant="contained" disabled={saveState.isLoading} onClick={onSave}>Save</Button>
    </>
  ) : (
    <>
      <Button component={RouterLink} to="/dashboards" startIcon={<ArrowBack />} color="inherit">All dashboards</Button>
      {editable && <Button startIcon={<EditIcon />} variant="contained" onClick={() => setDraft({ name: dashboard.name, widgets: dashboard.widgets })}>Edit</Button>}
    </>
  );

  return (
    <PageTransition>
      <PageHeader
        title={editing ? <TextField value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} size="small" slotProps={{ htmlInput: { 'aria-label': 'Dashboard name', style: { fontSize: 22, fontWeight: 700 } } }} /> : dashboard.name}
        description={dashboard.scope === 'account' ? 'Visible to everyone in your organization.' : 'Only you can see this dashboard.'} actions={actions}
      />
      {widgets.length === 0 ? (
        <Card>
          <EmptyState icon={<WidgetsIcon />} title="This dashboard is empty" description={editable ? 'Add numbers, charts, lists or saved reports.' : 'Nothing has been added yet.'} action={editable && !editing ? <Button variant="contained" onClick={() => setDraft({ name: dashboard.name, widgets: [] })}>Start editing</Button> : undefined} />
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(12, minmax(0, 1fr))' } }}>
          {widgets.map((w, i) => (
            <Card key={w.id} sx={{ gridColumn: { md: `span ${w.w}` }, p: 2, minHeight: w.type === 'kpi' ? 140 : HEIGHT[w.h], outline: editing ? '1px dashed' : 'none', outlineColor: 'primary.main' }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary" noWrap>{w.title || ' '}</Typography>
                {editing && (
                  <Stack direction="row">
                    <Tooltip title="Move earlier"><span><IconButton size="small" aria-label="Move widget earlier" disabled={i === 0} onClick={() => move(i, -1)}><UpIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title="Move later"><span><IconButton size="small" aria-label="Move widget later" disabled={i === widgets.length - 1} onClick={() => move(i, 1)}><DownIcon fontSize="small" /></IconButton></span></Tooltip>
                    <IconButton size="small" aria-label="Edit widget" onClick={() => setDialog({ widget: w, index: i })}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" aria-label="Remove widget" onClick={() => patch((ws) => ws.filter((_, j) => j !== i))}><DeleteIcon fontSize="small" /></IconButton>
                  </Stack>
                )}
              </Stack>
              <WidgetBody dashboardId={dashboardId} widget={w} />
            </Card>
          ))}
        </Box>
      )}
      {editing && editable && <Box sx={{ mt: 4 }}><Button color="error" onClick={() => setConfirmDelete(true)}>Delete dashboard</Button></Box>}

      {dialog && (
        <WidgetDialog
          widget={dialog.widget} onClose={() => setDialog(null)}
          onSave={(w) => { patch((ws) => (dialog.index === undefined ? [...ws, { ...w, id: `new_${crypto.randomUUID()}` }] : ws.map((x, j) => (j === dialog.index ? { ...x, ...w } : x)))); setDialog(null); }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete} destructive loading={removeState.isLoading} title={`Delete “${dashboard.name}”?`} confirmLabel="Delete dashboard" message="Its widgets are removed. Reports and records are not affected."
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { try { await remove(dashboardId).unwrap(); dispatch(showToast('Dashboard deleted')); navigate('/dashboards'); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }}
      />
    </PageTransition>
  );
}

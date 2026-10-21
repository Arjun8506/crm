import { useState } from 'react';
import { Autocomplete, Box, Button, Card, Checkbox, FormControlLabel, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { useDispatch, useSelector } from 'react-redux';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import ArrowBack from '@mui/icons-material/ArrowBackRounded';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import FilterIcon from '@mui/icons-material/FilterListRounded';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { store } from '../../app/store';
import { errorMessage } from '../../services/api';
import { downloadFile } from '../../services/download';
import { useGetDataformQuery, useListDataformsQuery } from '../dataforms/dataformsApi';
import { buildColumns } from '../records/columns';
import FilterBuilder, { countConditions, deserialize } from '../records/FilterBuilder';
import { useQueryRecordsQuery } from '../records/recordsApi';
import { showToast } from '../ui/uiSlice';
import AnalyzerPanel from './AnalyzerPanel';
import { useCreateReportMutation, useDeleteReportMutation, useGetReportQuery, useUpdateReportMutation } from './analyticsApi';

const EMPTY_LIST = { columns: [], filter: null, sort: 'createdAt:desc' };
const EMPTY_ANALYZER = { groupBy: [], metrics: [{ op: 'count' }], filter: null };

function ListReportBuilder({ dataform, fields, config, onChange }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [paging, setPaging] = useState({ page: 0, pageSize: 10 });
  const listFields = fields.filter((f) => f.visibility.list);
  const chosen = (config.columns?.length ? config.columns : listFields.map((f) => f.key)).map((k) => listFields.find((f) => f.key === k)).filter(Boolean);
  const sortable = [...listFields.filter((f) => !['multiselect', 'textarea', 'location'].includes(f.type)), { key: 'createdAt', label: 'Created' }, { key: 'updatedAt', label: 'Last updated' }];
  const [sortKey, sortDir] = (config.sort || 'createdAt:desc').split(':');
  const { data, isFetching, error, refetch } = useQueryRecordsQuery({ dataformId: dataform._id, page: paging.page + 1, limit: paging.pageSize, filter: config.filter || undefined, sort: config.sort || 'createdAt:desc' });
  const set = (patch) => { setPaging((p) => ({ ...p, page: 0 })); onChange({ ...config, ...patch }); };

  return (
    <Stack spacing={2.5}>
      <Card sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Autocomplete
            multiple options={listFields} value={chosen} getOptionLabel={(f) => f.label} isOptionEqualToValue={(a, b) => a.key === b.key}
            onChange={(_e, v) => set({ columns: v.map((f) => f.key) })} renderInput={(p) => <TextField {...p} label="Columns" helperText="Leave empty to include every visible field. Order follows your selection." />}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <TextField select size="small" label="Sort by" value={sortKey} sx={{ minWidth: 200 }} onChange={(e) => set({ sort: `${e.target.value}:${sortDir}` })}>
              {sortable.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Order" value={sortDir} sx={{ minWidth: 140 }} onChange={(e) => set({ sort: `${sortKey}:${e.target.value}` })}>
              <MenuItem value="asc">Ascending</MenuItem><MenuItem value="desc">Descending</MenuItem>
            </TextField>
            <Button variant="outlined" color="inherit" startIcon={<FilterIcon />} onClick={() => setFilterOpen(true)}>Filters{countConditions(config.filter) ? ` (${countConditions(config.filter)})` : ''}</Button>
            {countConditions(config.filter) > 0 && <Button size="small" onClick={() => set({ filter: null })}>Clear</Button>}
          </Stack>
        </Stack>
      </Card>
      <Card>
        {error ? <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error)} onRetry={refetch} /></Box> : (
          <DataGrid
            autoHeight density="compact" rows={data?.data ?? []} columns={buildColumns(chosen, data?.refs).filter((c) => c.field !== 'updatedAt')} getRowId={(r) => r._id}
            loading={isFetching} rowCount={data?.total ?? 0} paginationMode="server" paginationModel={paging} onPaginationModelChange={setPaging} pageSizeOptions={[10, 25, 50]}
            disableColumnFilter disableColumnSorting disableRowSelectionOnClick sx={{ border: 0 }}
            slots={{ noRowsOverlay: () => <EmptyState title="No records match" description="Adjust the filters to see rows here." /> }}
          />
        )}
      </Card>
      {filterOpen && <FilterBuilder open fields={fields} draft={deserialize(config.filter, fields)} onClose={() => setFilterOpen(false)} onApply={(tree) => { set({ filter: tree }); setFilterOpen(false); }} />}
    </Stack>
  );
}

export default function ReportEditorPage() {
  const { workspaceId, reportId, kind: kindParam } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const me = useSelector((s) => s.auth.user);
  const isNew = !reportId;
  const { data: saved, isLoading: loadingReport, error: reportError } = useGetReportQuery(reportId, { skip: isNew });
  const { data: dataforms = [] } = useListDataformsQuery({ workspaceId });
  const kind = isNew ? kindParam : saved?.kind;

  const [draft, setDraft] = useState(null); // user edits layered over the saved report
  const [dataformId, setDataformId] = useState('');
  const dfId = isNew ? (dataformId || dataforms[0]?._id) : saved?.dataform;
  const { data: meta, isLoading: loadingMeta } = useGetDataformQuery(dfId, { skip: !dfId });
  const [create, createState] = useCreateReportMutation();
  const [update, updateState] = useUpdateReportMutation();
  const [remove, removeState] = useDeleteReportMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!isNew && loadingReport) return <Skeleton variant="rounded" height={300} />;
  if (reportError) return <EmptyState title="Report not found" description="It may have been deleted, or it is private to someone else." action={<Button component={RouterLink} to={`/w/${workspaceId}/reports`}>Back to reports</Button>} />;
  if (kind !== 'list' && kind !== 'analyzer') return <EmptyState title="Unknown report type" />;

  const state = draft ?? {
    name: saved?.name ?? '', description: saved?.description ?? '', shared: saved?.shared ?? false,
    config: saved?.config ?? (kind === 'list' ? EMPTY_LIST : EMPTY_ANALYZER),
  };
  const edit = (patch) => setDraft({ ...state, ...patch });
  const mine = isNew || String(saved?.owner) === me?._id;
  const canSave = mine && state.name.trim().length > 0 && !!dfId;

  const save = async () => {
    try {
      const body = { name: state.name.trim(), description: state.description, shared: state.shared, config: state.config };
      if (isNew) {
        const res = await create({ ...body, dataformId: dfId, kind }).unwrap();
        dispatch(showToast('Report saved'));
        navigate(`/w/${workspaceId}/reports/${res.report._id}`, { replace: true });
      } else {
        await update({ id: reportId, ...body }).unwrap();
        setDraft(null);
        dispatch(showToast('Report saved'));
      }
    } catch (err) {
      dispatch(showToast(errorMessage(err, 'Could not save the report'), 'error'));
    }
  };

  const exportCsv = async () => {
    try {
      const c = state.config;
      await downloadFile(store, `/dataforms/${dfId}/records/export`, { filter: c.filter || undefined, sort: c.sort, columns: c.columns?.length ? c.columns : undefined, q: c.q || undefined }, 'report.csv');
    } catch (err) { dispatch(showToast(err.message, 'error')); }
  };

  return (
    <PageTransition>
      <PageHeader
        title={isNew ? (kind === 'list' ? 'New report' : 'New analysis') : state.name || 'Report'}
        description={kind === 'list' ? 'A saved list with chosen columns, filters and sorting.' : 'Group records, calculate totals, then click a row to drill into the source records.'}
        actions={(
          <>
            <Button component={RouterLink} to={`/w/${workspaceId}/reports`} startIcon={<ArrowBack />} color="inherit">Reports</Button>
            {kind === 'list' && dfId && <Button startIcon={<DownloadIcon />} onClick={exportCsv} color="inherit">Export CSV</Button>}
            {!isNew && mine && <Button color="error" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            {mine && <Button variant="contained" disabled={!canSave || createState.isLoading || updateState.isLoading} onClick={save}>Save</Button>}
          </>
        )}
      />
      <Stack spacing={2.5}>
        <Card sx={{ p: 2.5 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-start' } }}>
            <TextField label="Name" required value={state.name} onChange={(e) => edit({ name: e.target.value })} disabled={!mine} sx={{ flex: 2 }} />
            <TextField select label="Dataform" value={dfId ?? ''} onChange={(e) => { setDataformId(e.target.value); setDraft({ ...state, config: kind === 'list' ? EMPTY_LIST : EMPTY_ANALYZER }); }} disabled={!isNew} sx={{ flex: 1, minWidth: 200 }}>
              {dataforms.map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
            </TextField>
            <TextField label="Description" value={state.description} onChange={(e) => edit({ description: e.target.value })} disabled={!mine} sx={{ flex: 2 }} />
            <FormControlLabel control={<Checkbox checked={state.shared} disabled={!mine} onChange={(e) => edit({ shared: e.target.checked })} />} label="Shared" />
          </Stack>
          {!mine && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>This is a shared report owned by someone else. You can view it but not change it.</Typography>}
        </Card>
        {!dfId || loadingMeta || !meta ? <Skeleton variant="rounded" height={240} />
          : kind === 'list'
            ? <ListReportBuilder key={dfId} dataform={meta.dataform} fields={meta.fields} config={state.config} onChange={(config) => edit({ config })} />
            : <AnalyzerPanel key={dfId} dataform={meta.dataform} fields={meta.fields} workspaceId={workspaceId} config={state.config} onChange={(config) => edit({ config })} />}
      </Stack>
      <ConfirmDialog
        open={confirmDelete} destructive loading={removeState.isLoading} title={`Delete “${state.name}”?`} confirmLabel="Delete report"
        message="Dashboards that use this report will show an error for that widget." onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { try { await remove(reportId).unwrap(); dispatch(showToast('Report deleted')); navigate(`/w/${workspaceId}/reports`); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }}
      />
    </PageTransition>
  );
}

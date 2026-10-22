import { useMemo, useState } from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { Alert, Badge, Box, Button, Card, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, ListItemIcon, ListItemText, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import { Link as RouterLink, useLocation, useParams, useSearchParams } from 'react-router-dom';
import AddIcon from '@mui/icons-material/AddRounded';
import FilterIcon from '@mui/icons-material/FilterListRounded';
import SearchIcon from '@mui/icons-material/SearchRounded';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import UploadIcon from '@mui/icons-material/FileUploadOutlined';
import FormIcon from '@mui/icons-material/DynamicFormOutlined';
import MoreIcon from '@mui/icons-material/MoreHorizRounded';
import ImportDialog from '../dataops/ImportDialog';
import ExportDialog from '../dataops/ExportDialog';
import FormsDialog from '../publicforms/FormsDialog';
import TableViewIcon from '@mui/icons-material/TableRowsOutlined';
import CardsIcon from '@mui/icons-material/GridViewOutlined';
import KanbanIcon from '@mui/icons-material/ViewKanbanOutlined';
import CalendarIcon from '@mui/icons-material/CalendarMonthOutlined';
import MapIcon from '@mui/icons-material/PlaceOutlined';
import TableIcon from '@mui/icons-material/TableChartOutlined';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import useDebounce from '../../hooks/useDebounce';
import { showToast } from '../ui/uiSlice';
import { useGetDataformQuery } from '../dataforms/dataformsApi';
import FieldInput from './FieldInput';
import FilterBuilder, { countConditions, deserialize } from './FilterBuilder';
import { store } from '../../app/store';
import { downloadFile } from '../../services/download';
import CardsView from '../views/CardsView';
import KanbanView from '../views/KanbanView';
import CalendarView from '../views/CalendarView';
import MapView from '../views/MapView';
import ViewsToolbar from '../views/ViewsToolbar';
import RecordDrawer from './RecordDrawer';
import { buildColumns } from './columns';
import { isFieldEditable, toApiValue, toFormValue } from './fieldUtils';
import { useBulkRecordsMutation, useQueryRecordsQuery } from './recordsApi';

function BulkEditDialog({ open, fields, count, onClose, onApply }) {
  const editable = fields.filter((f) => isFieldEditable(f, 'edit') && !f.unique);
  const [key, setKey] = useState(editable[0]?.key);
  const field = editable.find((f) => f.key === key);
  const { control, handleSubmit, reset, formState: { errors } } = useForm({ defaultValues: { value: field ? toFormValue(field, null) : '' } });
  const input = field && { ...field, key: 'value', required: false };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Edit ${count} record${count === 1 ? '' : 's'}`}</DialogTitle>
      <DialogContent>
        {editable.length === 0 ? <Typography>No fields can be bulk edited.</Typography> : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label="Field" value={key} onChange={(e) => { setKey(e.target.value); reset({ value: toFormValue(editable.find((f) => f.key === e.target.value), null) }); }}>
              {editable.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
            </TextField>
            {input && <FieldInput key={key} field={{ ...input, label: 'New value', description: 'Leave empty to clear the value' }} control={control} errors={errors} />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!field} onClick={handleSubmit((v) => onApply(field, toApiValue(field, v.value)))}>Apply to selected</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function DataformPage() {
  const { workspaceId, dataformId } = useParams();
  const dispatch = useDispatch();
  const { data: meta, isLoading: metaLoading, error: metaError, refetch: refetchMeta } = useGetDataformQuery(dataformId);
  const [paging, setPaging] = useState({ page: 0, pageSize: 25 });
  const [sortModel, setSortModel] = useState([{ field: 'updatedAt', sort: 'desc' }]);
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const location = useLocation();
  const [filter, setFilter] = useState(() => location.state?.filter ?? null);
  const [draft, setDraft] = useState(null);
  const [viewType, setViewType] = useState('table');
  const [viewConfig, setViewConfig] = useState({});
  const [hidden, setHidden] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selection, setSelection] = useState({ type: 'include', ids: new Set() });
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedRecord = searchParams.get('record');
  const [drawerState, setDrawer] = useState({ open: false, recordId: null });
  // A notification link (?record=<id>) opens that record; closing the drawer clears the parameter.
  const drawer = linkedRecord ? { open: true, recordId: linkedRecord } : drawerState;
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [dataMenu, setDataMenu] = useState(null);
  const [tool, setTool] = useState(null); // 'import' | 'export' | 'forms'
  const [bulk, bulkState] = useBulkRecordsMutation();

  const fields = meta?.fields;
  const args = useMemo(() => ({
    dataformId, page: paging.page + 1, limit: paging.pageSize, q: q || undefined, filter: filter || undefined,
    sort: sortModel[0] ? `${sortModel[0].field}:${sortModel[0].sort}` : 'updatedAt:desc',
  }), [dataformId, paging, q, filter, sortModel]);
  const { data, isFetching, error, refetch } = useQueryRecordsQuery(args, { skip: !fields || viewType !== 'table' });

  const columns = useMemo(() => (fields ? buildColumns(fields, data?.refs) : []), [fields, data?.refs]);
  const rows = data?.data ?? [];
  const selectedIds = selection.type === 'include' ? [...selection.ids] : rows.map((r) => r._id).filter((id) => !selection.ids.has(id));
  const filterCount = countConditions(filter);

  if (metaLoading) return <Box sx={{ py: 8, textAlign: 'center' }}><Typography color="text.secondary">Loading…</Typography></Box>;
  if (metaError) return <ErrorState message={errorMessage(metaError, 'Could not load this dataform')} onRetry={refetchMeta} />;

  const { dataform, access } = meta;
  const canWrite = access !== 'viewer' && dataform.status !== 'archived';
  const resetPage = () => setPaging((p) => ({ ...p, page: 0 }));
  const clearSelection = () => setSelection({ type: 'include', ids: new Set() });

  const runBulk = async (body, ok) => {
    try {
      const res = await bulk({ dataformId, ...body }).unwrap();
      dispatch(showToast(`${ok} ${res.affected} record${res.affected === 1 ? '' : 's'}`));
      clearSelection();
      return true;
    } catch (err) {
      dispatch(showToast(errorMessage(err, 'Bulk action failed'), 'error'));
      return false;
    }
  };

  const sortString = sortModel[0] ? `${sortModel[0].field}:${sortModel[0].sort}` : undefined;
  const snapshot = () => ({ type: viewType, config: { q: search || undefined, filter: filter || undefined, sort: sortString, hiddenColumns: hidden, ...viewConfig } });
  const applyView = (view, { silent } = {}) => {
    const c = view.config || {};
    setActiveViewId(view._id);
    if (silent) return;
    setViewType(view.type);
    setSearch(c.q ?? '');
    setFilter(c.filter ?? null);
    setDraft(null);
    setHidden(c.hiddenColumns ?? []);
    const [field, dir] = (c.sort || 'updatedAt:desc').split(':');
    setSortModel([{ field, sort: dir }]);
    setViewConfig({ groupField: c.groupField, dateField: c.dateField, locationField: c.locationField, cardFields: c.cardFields });
    resetPage();
    clearSelection();
  };
  const clearView = () => {
    setActiveViewId(null); setViewType('table'); setViewConfig({}); setHidden([]); setSearch(''); setFilter(null); setDraft(null);
    setSortModel([{ field: 'updatedAt', sort: 'desc' }]); resetPage();
  };
  const exportCsv = async () => {
    try {
      const visible = fields.filter((f) => f.visibility.list && !hidden.includes(f.key)).map((f) => f.key);
      await downloadFile(store, `/dataforms/${dataformId}/records/export`, { q: q || undefined, filter: filter || undefined, sort: sortString, columns: visible }, `${dataform.slug}.csv`);
    } catch (err) { dispatch(showToast(err.message, 'error')); }
  };
  const hasLocation = fields.some((f) => f.type === 'location');
  const viewQuery = { q, filter, sort: undefined };
  const common = {
    dataform, fields, query: viewQuery, config: viewConfig, canWrite,
    onConfig: (patch) => setViewConfig((c) => ({ ...c, ...patch })), onOpen: (id) => setDrawer({ open: true, recordId: id }),
  };

  const newButton = canWrite && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawer({ open: true, recordId: null })}>New record</Button>;
  const settingsButton = access === 'admin' && <Button component={RouterLink} to={`/w/${workspaceId}/f/${dataformId}/settings`} startIcon={<SettingsIcon />} color="inherit">Settings</Button>;

  return (
    <PageTransition>
      <PageHeader title={dataform.name} description={dataform.description} actions={<>{settingsButton}{newButton}</>} />
      {dataform.status === 'archived' && <Alert severity="info" sx={{ mb: 2 }}>This dataform is archived. Records are read-only.</Alert>}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2, justifyContent: 'space-between', alignItems: { md: 'center' } }}>
        <ToggleButtonGroup size="small" exclusive value={viewType} onChange={(_e, v) => v && setViewType(v)} aria-label="Layout">
          <ToggleButton value="table"><TableViewIcon fontSize="small" sx={{ mr: 0.75 }} />Table</ToggleButton>
          <ToggleButton value="cards"><CardsIcon fontSize="small" sx={{ mr: 0.75 }} />Cards</ToggleButton>
          <ToggleButton value="kanban"><KanbanIcon fontSize="small" sx={{ mr: 0.75 }} />Board</ToggleButton>
          <ToggleButton value="calendar"><CalendarIcon fontSize="small" sx={{ mr: 0.75 }} />Calendar</ToggleButton>
          <ToggleButton value="map" disabled={!hasLocation} title={hasLocation ? undefined : 'Needs a Location field'}><MapIcon fontSize="small" sx={{ mr: 0.75 }} />Map</ToggleButton>
        </ToggleButtonGroup>
        <ViewsToolbar dataformId={dataformId} canShare={access !== 'viewer'} snapshot={snapshot} activeId={activeViewId} onApply={applyView} onClear={clearView} />
      </Stack>

      <Card>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, p: 2 }}>
          <TextField
            placeholder={`Search ${dataform.name.toLowerCase()}`} value={search} onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            sx={{ width: { sm: 320 } }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search records' } }}
          />
          <Badge badgeContent={filterCount} color="primary">
            <Button variant="outlined" color="inherit" startIcon={<FilterIcon />} onClick={() => setFilterOpen(true)}>Filters</Button>
          </Badge>
          {filterCount > 0 && <Button size="small" onClick={() => { setFilter(null); setDraft(null); resetPage(); }}>Clear filters</Button>}
          <Box sx={{ flex: 1 }} />
          {viewType === 'table' && data && <Typography variant="body2" color="text.secondary">{data.total.toLocaleString()} record{data.total === 1 ? '' : 's'}</Typography>}
          <Button size="small" color="inherit" startIcon={<MoreIcon />} onClick={(e) => setDataMenu(e.currentTarget)} aria-haspopup="menu">Import / export</Button>
          <Menu anchorEl={dataMenu} open={!!dataMenu} onClose={() => setDataMenu(null)}>
            {canWrite && dataform.status !== 'archived' && <MenuItem onClick={() => { setDataMenu(null); setTool('import'); }}><ListItemIcon><UploadIcon fontSize="small" /></ListItemIcon><ListItemText>Import from CSV…</ListItemText></MenuItem>}
            <MenuItem onClick={() => { setDataMenu(null); exportCsv(); }}><ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon><ListItemText>Download current view (CSV)</ListItemText></MenuItem>
            <MenuItem onClick={() => { setDataMenu(null); setTool('export'); }}><ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon><ListItemText>Export in background (CSV or ZIP with files)…</ListItemText></MenuItem>
            {access === 'admin' && <MenuItem onClick={() => { setDataMenu(null); setTool('forms'); }}><ListItemIcon><FormIcon fontSize="small" /></ListItemIcon><ListItemText>Public forms…</ListItemText></MenuItem>}
          </Menu>
        </Stack>

        {viewType === 'table' && selectedIds.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 2, py: 1, bgcolor: 'action.selected' }}>
            <Checkbox checked indeterminate={false} onChange={clearSelection} slotProps={{ input: { 'aria-label': 'Clear selection' } }} />
            <Typography sx={{ flex: 1 }}>{selectedIds.length} selected</Typography>
            {canWrite && <Button size="small" onClick={() => setBulkEdit(true)}>Edit field</Button>}
            {canWrite && <Button size="small" color="error" onClick={() => setConfirmBulkDelete(true)}>Delete</Button>}
          </Stack>
        )}

        {viewType === 'cards' && <CardsView {...common} query={{ ...viewQuery, sort: 'updatedAt:desc' }} />}
        {viewType === 'kanban' && <KanbanView {...common} />}
        {viewType === 'calendar' && <CalendarView {...common} />}
        {viewType === 'map' && <MapView {...common} />}
        {viewType === 'table' && (error ? <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error, 'Could not load records')} onRetry={refetch} /></Box> : (
          <DataGrid
            autoHeight rows={rows} columns={columns} getRowId={(r) => r._id} loading={isFetching || !fields} rowCount={data?.total ?? 0}
            paginationMode="server" sortingMode="server" filterMode="server" pageSizeOptions={[10, 25, 50, 100]} paginationModel={{ page: paging.page, pageSize: paging.pageSize }}
            onPaginationModelChange={(m) => { setPaging(m); }} sortModel={sortModel} onSortModelChange={(m) => { setSortModel(m); resetPage(); }}
            checkboxSelection={canWrite} disableRowSelectionOnClick rowSelectionModel={selection} onRowSelectionModelChange={setSelection}
            onRowClick={(p) => setDrawer({ open: true, recordId: p.row._id })} disableColumnFilter density="compact" showToolbar
            columnVisibilityModel={Object.fromEntries(hidden.map((k) => [k, false]))}
            onColumnVisibilityModelChange={(m) => setHidden(Object.entries(m).filter(([, v]) => v === false).map(([k]) => k))}
            slotProps={{ toolbar: { csvOptions: { disableToolbarButton: true }, printOptions: { disableToolbarButton: true } } }}
            slots={{
              noRowsOverlay: () => (
                <EmptyState
                  icon={<TableIcon />} title={filterCount || q ? 'No records match' : 'No records yet'}
                  description={filterCount || q ? 'Try changing or clearing your search and filters.' : 'Create the first record to get started.'}
                  action={!filterCount && !q ? newButton : undefined}
                />
              ),
            }}
            sx={{ border: 0, borderTop: 1, borderColor: 'divider', '& .MuiDataGrid-row': { cursor: 'pointer' }, '& .MuiDataGrid-cell:focus': { outline: 'none' } }}
          />
        ))}
      </Card>

      {filterOpen && (
        <FilterBuilder
          open fields={fields} draft={draft ?? deserialize(filter, fields)} onClose={() => setFilterOpen(false)}
          onApply={(tree, d) => { setFilter(tree); setDraft(d); resetPage(); clearSelection(); setFilterOpen(false); }}
        />
      )}
      {tool === 'import' && <ImportDialog open dataform={dataform} onClose={() => setTool(null)} />}
      {tool === 'export' && <ExportDialog open dataform={dataform} params={{ q: q || undefined, filter: filter || undefined, sort: sortString, columns: fields.filter((f) => f.visibility.list && !hidden.includes(f.key)).map((f) => f.key) }} onClose={() => setTool(null)} />}
      {tool === 'forms' && <FormsDialog open dataform={dataform} onClose={() => setTool(null)} />}
      {drawer.open && <RecordDrawer open dataform={dataform} fields={fields} canWrite={canWrite} canModerate={access === 'admin'} recordId={drawer.recordId} onClose={() => { setDrawer({ open: false, recordId: null }); if (linkedRecord) setSearchParams({}, { replace: true }); }} />}
      {bulkEdit && (
        <BulkEditDialog
          open fields={fields} count={selectedIds.length} onClose={() => setBulkEdit(false)}
          onApply={async (field, value) => { if (await runBulk({ action: 'update', ids: selectedIds, data: { [field.key]: value } }, 'Updated')) setBulkEdit(false); }}
        />
      )}
      <ConfirmDialog
        open={confirmBulkDelete} destructive loading={bulkState.isLoading} title={`Delete ${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'}?`}
        message="This cannot be undone." confirmLabel="Delete" onClose={() => setConfirmBulkDelete(false)}
        onConfirm={async () => { if (await runBulk({ action: 'delete', ids: selectedIds }, 'Deleted')) setConfirmBulkDelete(false); }}
      />
    </PageTransition>
  );
}

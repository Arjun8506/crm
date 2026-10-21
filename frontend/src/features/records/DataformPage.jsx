import { useMemo, useState } from 'react';
import { Alert, Badge, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import { Link as RouterLink, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import AddIcon from '@mui/icons-material/AddRounded';
import FilterIcon from '@mui/icons-material/FilterListRounded';
import SearchIcon from '@mui/icons-material/SearchRounded';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import TableIcon from '@mui/icons-material/TableChartOutlined';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import useDebounce from '../../hooks/useDebounce';
import { showToast } from '../ui/uiSlice';
import { useGetDataformQuery } from '../dataforms/dataformsApi';
import FieldInput from './FieldInput';
import FilterBuilder, { countConditions } from './FilterBuilder';
import RecordDrawer from './RecordDrawer';
import { formatValue, isFieldEditable, optionLabel, toApiValue, toFormValue } from './fieldUtils';
import { useBulkRecordsMutation, useQueryRecordsQuery } from './recordsApi';

const UNSORTABLE = new Set(['multiselect', 'textarea']);
const WIDTH = { textarea: 240, url: 200, email: 220, datetime: 170, date: 130, boolean: 100, integer: 120, decimal: 120, relationship: 180 };

function buildColumns(fields, refs) {
  const cols = fields.filter((f) => f.visibility.list).map((f) => ({
    field: f.key,
    headerName: f.label,
    width: WIDTH[f.type] ?? 170,
    sortable: !UNSORTABLE.has(f.type),
    type: f.type === 'integer' || f.type === 'decimal' ? 'number' : undefined,
    valueGetter: (_v, row) => row.data?.[f.key] ?? null,
    renderCell: ({ value }) => {
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return <Typography color="text.disabled">-</Typography>;
      switch (f.type) {
        case 'boolean': return <Chip size="small" label={value ? 'Yes' : 'No'} color={value ? 'success' : 'default'} variant={value ? 'filled' : 'outlined'} />;
        case 'dropdown': return <Chip size="small" label={optionLabel(f, value)} />;
        case 'multiselect': return <Stack direction="row" spacing={0.5}>{value.map((v) => <Chip key={v} size="small" variant="outlined" label={optionLabel(f, v)} />)}</Stack>;
        case 'relationship': return <Chip size="small" variant="outlined" label={refs?.[f.key]?.[value] ?? 'Unknown record'} />;
        case 'url': return <Link href={value} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{value.replace(/^https?:\/\//, '')}</Link>;
        case 'email': return <Link href={`mailto:${value}`} onClick={(e) => e.stopPropagation()}>{value}</Link>;
        default: return formatValue(f, value);
      }
    },
  }));
  cols.push({ field: 'updatedAt', headerName: 'Updated', width: 150, valueGetter: (_v, row) => row.updatedAt, valueFormatter: (v) => dayjs(v).format('MMM D, YYYY') });
  return cols;
}

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
  const [filter, setFilter] = useState(null);
  const [draft, setDraft] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selection, setSelection] = useState({ type: 'include', ids: new Set() });
  const [drawer, setDrawer] = useState({ open: false, recordId: null });
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [bulk, bulkState] = useBulkRecordsMutation();

  const fields = meta?.fields;
  const args = useMemo(() => ({
    dataformId, page: paging.page + 1, limit: paging.pageSize, q: q || undefined, filter: filter || undefined,
    sort: sortModel[0] ? `${sortModel[0].field}:${sortModel[0].sort}` : 'updatedAt:desc',
  }), [dataformId, paging, q, filter, sortModel]);
  const { data, isFetching, error, refetch } = useQueryRecordsQuery(args, { skip: !fields });

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

  const newButton = canWrite && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawer({ open: true, recordId: null })}>New record</Button>;
  const settingsButton = access === 'admin' && <Button component={RouterLink} to={`/w/${workspaceId}/f/${dataformId}/settings`} startIcon={<SettingsIcon />} color="inherit">Settings</Button>;

  return (
    <PageTransition>
      <PageHeader title={dataform.name} description={dataform.description} actions={<>{settingsButton}{newButton}</>} />
      {dataform.status === 'archived' && <Alert severity="info" sx={{ mb: 2 }}>This dataform is archived. Records are read-only.</Alert>}

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
          {data && <Typography variant="body2" color="text.secondary">{data.total.toLocaleString()} record{data.total === 1 ? '' : 's'}</Typography>}
        </Stack>

        {selectedIds.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 2, py: 1, bgcolor: 'action.selected' }}>
            <Checkbox checked indeterminate={false} onChange={clearSelection} slotProps={{ input: { 'aria-label': 'Clear selection' } }} />
            <Typography sx={{ flex: 1 }}>{selectedIds.length} selected</Typography>
            {canWrite && <Button size="small" onClick={() => setBulkEdit(true)}>Edit field</Button>}
            {canWrite && <Button size="small" color="error" onClick={() => setConfirmBulkDelete(true)}>Delete</Button>}
          </Stack>
        )}

        {error ? <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error, 'Could not load records')} onRetry={refetch} /></Box> : (
          <DataGrid
            autoHeight rows={rows} columns={columns} getRowId={(r) => r._id} loading={isFetching || !fields} rowCount={data?.total ?? 0}
            paginationMode="server" sortingMode="server" filterMode="server" pageSizeOptions={[10, 25, 50, 100]} paginationModel={{ page: paging.page, pageSize: paging.pageSize }}
            onPaginationModelChange={(m) => { setPaging(m); }} sortModel={sortModel} onSortModelChange={(m) => { setSortModel(m); resetPage(); }}
            checkboxSelection={canWrite} disableRowSelectionOnClick rowSelectionModel={selection} onRowSelectionModelChange={setSelection}
            onRowClick={(p) => setDrawer({ open: true, recordId: p.row._id })} disableColumnFilter density="compact" showToolbar
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
        )}
      </Card>

      {filterOpen && (
        <FilterBuilder
          open fields={fields} draft={draft} onClose={() => setFilterOpen(false)}
          onApply={(tree, d) => { setFilter(tree); setDraft(d); resetPage(); clearSelection(); setFilterOpen(false); }}
        />
      )}
      {drawer.open && <RecordDrawer open dataform={dataform} fields={fields} canWrite={canWrite} recordId={drawer.recordId} onClose={() => setDrawer({ open: false, recordId: null })} />}
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

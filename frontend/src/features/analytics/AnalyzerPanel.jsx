import { useState } from 'react';
import { Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import AddIcon from '@mui/icons-material/AddRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import FilterIcon from '@mui/icons-material/FilterListRounded';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { buildColumns } from '../records/columns';
import FilterBuilder, { countConditions, deserialize } from '../records/FilterBuilder';
import { formatValue } from '../records/fieldUtils';
import { useQueryRecordsQuery } from '../records/recordsApi';
import { ExplainButton } from '../ai/AiAssist';
import { useAnalyzeQuery } from './analyticsApi';

const GROUPABLE = new Set(['text', 'email', 'phone', 'dropdown', 'boolean', 'date', 'datetime', 'relationship', 'integer', 'multiselect']);
const BUILTIN = [{ key: 'createdAt', label: 'Created', type: 'datetime' }, { key: 'updatedAt', label: 'Last updated', type: 'datetime' }];
const INTERVALS = ['day', 'week', 'month', 'quarter', 'year'];
const OPS = { count: 'Count', sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' };

export function formatGroupKey(group, value, refs, fields) {
  if (value === null || value === undefined) return '(empty)';
  if (group.interval) {
    const d = dayjs(value);
    return { day: d.format('MMM D, YYYY'), week: `Week of ${d.format('MMM D, YYYY')}`, month: d.format('MMM YYYY'), quarter: `Q${Math.floor(d.month() / 3) + 1} ${d.year()}`, year: d.format('YYYY') }[group.interval];
  }
  if (group.type === 'relationship') return refs?.[group.field]?.[value] ?? 'Unknown record';
  const f = fields.find((x) => x.key === group.field);
  return f ? (formatValue(f.type === 'multiselect' ? { ...f, type: 'dropdown' } : f, value) || '(empty)') : String(value);
}

// Dropdown groups read best in the order the options were defined (e.g. pipeline stages), not alphabetically.
export function orderRows(data, fields) {
  const first = data.groups[0] && fields.find((f) => f.key === data.groups[0].field);
  if (first?.type !== 'dropdown') return data.rows;
  const idx = (v) => { const i = first.options.findIndex((o) => o.value === v); return i < 0 ? 999 : i; };
  return [...data.rows].sort((a, b) => idx(a.keys[0]) - idx(b.keys[0]));
}

export const metricLabel = (m, fields) => (m.op === 'count' ? 'Count' : `${OPS[m.op]} of ${fields.find((f) => f.key === m.field)?.label ?? m.field}`);
const fmtNumber = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

function DrillDialog({ dataform, fields, filter, workspaceId, title, onClose }) {
  const navigate = useNavigate();
  const [paging, setPaging] = useState({ page: 0, pageSize: 10 });
  const { data, isFetching, error } = useQueryRecordsQuery({ dataformId: dataform._id, page: paging.page + 1, limit: paging.pageSize, filter, sort: 'updatedAt:desc' });
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {error ? <ErrorState message={errorMessage(error)} /> : (
          <DataGrid
            autoHeight density="compact" rows={data?.data ?? []} columns={buildColumns(fields, data?.refs)} getRowId={(r) => r._id} loading={isFetching}
            rowCount={data?.total ?? 0} paginationMode="server" paginationModel={paging} onPaginationModelChange={setPaging} pageSizeOptions={[10, 25]}
            disableColumnFilter disableRowSelectionOnClick disableColumnSorting
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => navigate(`/w/${workspaceId}/f/${dataform._id}`, { state: { filter } })}>Open in table view</Button>
        <Button color="inherit" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function AnalyzerPanel({ dataform, fields, workspaceId, config, onChange }) {
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [filterOpen, setFilterOpen] = useState(false);
  const [drill, setDrill] = useState(null);
  const groupFields = [...fields.filter((f) => GROUPABLE.has(f.type) && f.visibility.list), ...BUILTIN];
  const numberFields = fields.filter((f) => f.type === 'integer' || f.type === 'decimal');
  const groupBy = config.groupBy ?? [];
  const metrics = config.metrics?.length ? config.metrics : [{ op: 'count' }];
  const complete = metrics.every((m) => m.op === 'count' || m.field);
  const set = (patch) => { setPage(0); onChange({ ...config, groupBy, metrics, ...patch }); };

  const { data, isFetching, error, refetch } = useAnalyzeQuery(
    { dataformId: dataform._id, groupBy, metrics, filter: config.filter || undefined, q: config.q || undefined, page: page + 1, limit },
    { skip: !complete },
  );
  const typeOf = (key) => groupFields.find((f) => f.key === key)?.type;
  const isDate = (key) => ['date', 'datetime'].includes(typeOf(key));

  return (
    <Stack spacing={2.5}>
      <Card sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Group by (up to 3 levels)</Typography>
            <Stack spacing={1}>
              {groupBy.map((g, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField select size="small" label={`Level ${i + 1}`} value={g.field} sx={{ minWidth: 200 }} onChange={(e) => set({ groupBy: groupBy.map((x, j) => (j === i ? { field: e.target.value, ...(isDate(e.target.value) ? { interval: 'month' } : {}) } : x)) })}>
                    {groupFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
                  </TextField>
                  {isDate(g.field) && (
                    <TextField select size="small" label="By" value={g.interval ?? 'month'} sx={{ minWidth: 130 }} onChange={(e) => set({ groupBy: groupBy.map((x, j) => (j === i ? { ...x, interval: e.target.value } : x)) })}>
                      {INTERVALS.map((v) => <MenuItem key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</MenuItem>)}
                    </TextField>
                  )}
                  <IconButton size="small" aria-label="Remove grouping" onClick={() => set({ groupBy: groupBy.filter((_, j) => j !== i) })}><CloseIcon fontSize="small" /></IconButton>
                </Stack>
              ))}
              {groupBy.length < 3 && <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }} onClick={() => set({ groupBy: [...groupBy, { field: groupFields[0].key, ...(['date', 'datetime'].includes(groupFields[0].type) ? { interval: 'month' } : {}) }] })}>Add grouping</Button>}
            </Stack>
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Measures</Typography>
            <Stack spacing={1}>
              {metrics.map((m, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField select size="small" label="Calculation" value={m.op} sx={{ minWidth: 150 }} onChange={(e) => set({ metrics: metrics.map((x, j) => (j === i ? { op: e.target.value, ...(e.target.value !== 'count' ? { field: numberFields[0]?.key } : {}) } : x)) })}>
                    {Object.entries(OPS).map(([k, l]) => <MenuItem key={k} value={k} disabled={k !== 'count' && numberFields.length === 0}>{l}</MenuItem>)}
                  </TextField>
                  {m.op !== 'count' && (
                    <TextField select size="small" label="Of field" value={m.field ?? ''} sx={{ minWidth: 200 }} onChange={(e) => set({ metrics: metrics.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>
                      {numberFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
                    </TextField>
                  )}
                  {metrics.length > 1 && <IconButton size="small" aria-label="Remove measure" onClick={() => set({ metrics: metrics.filter((_, j) => j !== i) })}><CloseIcon fontSize="small" /></IconButton>}
                </Stack>
              ))}
              {metrics.length < 5 && <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }} onClick={() => set({ metrics: [...metrics, { op: 'count' }] })}>Add measure</Button>}
            </Stack>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button variant="outlined" color="inherit" startIcon={<FilterIcon />} onClick={() => setFilterOpen(true)}>Filters{countConditions(config.filter) ? ` (${countConditions(config.filter)})` : ''}</Button>
            {countConditions(config.filter) > 0 && <Button size="small" onClick={() => set({ filter: null })}>Clear</Button>}
            <Box sx={{ flex: 1 }} />
            {data && data.rows.length > 0 && <ExplainButton dataformId={dataform._id} analysis={{ groupBy, metrics, filter: config.filter || undefined, q: config.q || undefined }} />}
          </Stack>
        </Stack>
      </Card>

      <Card>
        {error ? <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error, 'Could not run the analysis')} onRetry={refetch} /></Box>
          : !data ? <Skeleton variant="rounded" height={200} />
            : data.rows.length === 0 ? <EmptyState title="No data" description="No records match the current filters." /> : (
              <TableContainer sx={{ opacity: isFetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
                <Table size="small" sx={{ '& td, & th': { py: 1 } }}>
                  <TableHead>
                    <TableRow>
                      {data.groups.map((g) => <TableCell key={g.field}><b>{g.label}</b>{g.interval ? ` (${g.interval})` : ''}</TableCell>)}
                      {data.metrics.map((m) => <TableCell key={m.key} align="right"><b>{metricLabel(m, fields)}</b></TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orderRows(data, fields).map((r, ri, rows) => {
                      const prev = rows[ri - 1];
                      return (
                        <TableRow key={JSON.stringify(r.keys)} hover sx={{ cursor: 'pointer' }} onClick={() => setDrill(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setDrill(r)}>
                          {data.groups.map((g, gi) => {
                            // Hide a key when it repeats the row above (and every level before it matches), like a pivot table.
                            const repeat = prev && r.keys.slice(0, gi + 1).every((k, i) => k === prev.keys[i]);
                            return <TableCell key={g.field} sx={{ color: r.keys[gi] === null ? 'text.disabled' : undefined }}>{repeat ? '' : formatGroupKey(g, r.keys[gi], data.refs, fields)}</TableCell>;
                          })}
                          {data.metrics.map((m) => <TableCell key={m.key} align="right">{fmtNumber(r.metrics[m.key])}</TableCell>)}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={Math.max(1, data.groups.length)}><b>Total</b></TableCell>
                      {data.metrics.map((m) => <TableCell key={m.key} align="right"><b>{fmtNumber(data.totals[m.key])}</b></TableCell>)}
                    </TableRow>
                  </TableFooter>
                </Table>
                {data.groups.length > 0 && (
                  <TablePagination
                    component="div" count={data.total} page={page} rowsPerPage={limit} rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Groups per page"
                    onPageChange={(_e, p) => setPage(p)} onRowsPerPageChange={(e) => { setLimit(Number(e.target.value)); setPage(0); }}
                  />
                )}
              </TableContainer>
            )}
        <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>Click a row to see the records behind it.</Typography>
      </Card>

      {filterOpen && <FilterBuilder open fields={fields} draft={deserialize(config.filter, fields)} onClose={() => setFilterOpen(false)} onApply={(tree) => { set({ filter: tree }); setFilterOpen(false); }} />}
      {drill && (
        <DrillDialog
          dataform={dataform} fields={fields} workspaceId={workspaceId} onClose={() => setDrill(null)}
          title={data.groups.length ? drill.keys.map((k, i) => formatGroupKey(data.groups[i], k, data.refs, fields)).join(' › ') : 'All records'}
          filter={{ op: 'and', conditions: [...(config.filter ? [config.filter] : []), drill.drill] }}
        />
      )}
    </Stack>
  );
}

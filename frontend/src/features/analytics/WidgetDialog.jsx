import { useState } from 'react';
import { Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import FilterIcon from '@mui/icons-material/FilterListRounded';
import { useGetDataformQuery, useListDataformsQuery } from '../dataforms/dataformsApi';
import FilterBuilder, { countConditions, deserialize } from '../records/FilterBuilder';
import { useListWorkspacesQuery } from '../workspaces/workspacesApi';
import { useListReportsQuery } from './analyticsApi';

const GROUPABLE = new Set(['text', 'email', 'phone', 'dropdown', 'boolean', 'date', 'datetime', 'relationship', 'integer', 'multiselect']);
const INTERVALS = ['day', 'week', 'month', 'quarter', 'year'];
const SIZES = [[3, 'Small (¼)'], [4, 'Third'], [6, 'Half'], [8, 'Two thirds'], [12, 'Full width']];
const DEFAULTS = {
  kpi: { metric: { op: 'count' }, filter: null },
  chart: { chart: 'bar', groupBy: null, metric: { op: 'count' }, filter: null, limit: 12 },
  list: { filter: null, sort: 'createdAt:desc', columns: [], limit: 8 },
  report: {},
};

export default function WidgetDialog({ widget, onSave, onClose }) {
  const editing = !!widget;
  const [type, setType] = useState(widget?.type ?? 'kpi');
  const [title, setTitle] = useState(widget?.title ?? '');
  const [w, setW] = useState(widget?.w ?? 6);
  const [h, setH] = useState(widget?.h ?? 1);
  const [config, setConfig] = useState(widget?.config ?? DEFAULTS.kpi);
  const [filterOpen, setFilterOpen] = useState(false);
  const { data: workspaces = [] } = useListWorkspacesQuery();
  const { data: existing } = useGetDataformQuery(widget?.config?.dataformId, { skip: !widget?.config?.dataformId });
  const [wsPick, setWsPick] = useState(null);
  const wsId = wsPick ?? existing?.dataform.workspace ?? workspaces[0]?._id;
  const { data: dataforms = [] } = useListDataformsQuery({ workspaceId: wsId }, { skip: !wsId });
  const { data: reports = [] } = useListReportsQuery(wsId, { skip: !wsId || type !== 'report' });
  const dfId = config.dataformId;
  const { data: meta } = useGetDataformQuery(dfId, { skip: !dfId || type === 'report' });
  const fields = meta?.fields ?? [];
  const numberFields = fields.filter((f) => f.type === 'integer' || f.type === 'decimal');
  const groupFields = fields.filter((f) => GROUPABLE.has(f.type) && f.visibility.list);
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const changeType = (t) => { setType(t); setConfig({ ...DEFAULTS[t] }); if (t === 'chart') { setH(2); } };
  const groupMeta = fields.find((f) => f.key === config.groupBy?.field);
  const isDate = groupMeta && ['date', 'datetime'].includes(groupMeta.type);

  const valid = type === 'report' ? !!config.reportId
    : !!dfId && (type !== 'chart' || !!config.groupBy?.field) && (config.metric?.op === 'count' || !config.metric || !!config.metric.field);

  const metricEditor = (
    <Stack direction="row" spacing={1.5}>
      <TextField select label="Calculation" fullWidth value={config.metric?.op ?? 'count'} onChange={(e) => set({ metric: e.target.value === 'count' ? { op: 'count' } : { op: e.target.value, field: numberFields[0]?.key } })}>
        <MenuItem value="count">Count of records</MenuItem>
        {['sum', 'avg', 'min', 'max'].map((o) => <MenuItem key={o} value={o} disabled={!numberFields.length}>{{ sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' }[o]}</MenuItem>)}
      </TextField>
      {config.metric?.op !== 'count' && (
        <TextField select label="Of field" fullWidth value={config.metric?.field ?? ''} onChange={(e) => set({ metric: { ...config.metric, field: e.target.value } })}>
          {numberFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
        </TextField>
      )}
    </Stack>
  );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Edit widget' : 'Add widget'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select label="Type" fullWidth value={type} disabled={editing} onChange={(e) => changeType(e.target.value)}>
              <MenuItem value="kpi">Number (KPI)</MenuItem><MenuItem value="chart">Chart</MenuItem><MenuItem value="list">Record list</MenuItem><MenuItem value="report">Saved report</MenuItem>
            </TextField>
            <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField select label="Width" fullWidth value={w} onChange={(e) => setW(Number(e.target.value))}>{SIZES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField>
            <TextField select label="Height" fullWidth value={h} onChange={(e) => setH(Number(e.target.value))}><MenuItem value={1}>Short</MenuItem><MenuItem value={2}>Tall</MenuItem></TextField>
          </Stack>

          <Stack direction="row" spacing={1.5}>
            <TextField select label="Workspace" fullWidth value={wsId ?? ''} onChange={(e) => { setWsPick(e.target.value); setConfig({ ...DEFAULTS[type] }); }}>
              {workspaces.map((x) => <MenuItem key={x._id} value={x._id}>{x.name}</MenuItem>)}
            </TextField>
            {type === 'report' ? (
              <TextField select label="Report" fullWidth value={config.reportId ?? ''} onChange={(e) => set({ reportId: e.target.value })} helperText={reports.length ? undefined : 'No reports in this workspace'}>
                {reports.map((r) => <MenuItem key={r._id} value={r._id}>{r.name}</MenuItem>)}
              </TextField>
            ) : (
              <TextField select label="Dataform" fullWidth value={dfId ?? ''} onChange={(e) => setConfig({ ...DEFAULTS[type], dataformId: e.target.value })}>
                {dataforms.map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
              </TextField>
            )}
          </Stack>

          {type !== 'report' && dfId && meta && (
            <>
              {(type === 'kpi' || type === 'chart') && metricEditor}
              {type === 'chart' && (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1.5}>
                    <TextField select label="Chart" fullWidth value={config.chart} onChange={(e) => set({ chart: e.target.value })}>
                      <MenuItem value="bar">Bar</MenuItem><MenuItem value="line">Line</MenuItem><MenuItem value="pie">Pie / donut</MenuItem>
                    </TextField>
                    <TextField select label="Group by" fullWidth value={config.groupBy?.field ?? ''} onChange={(e) => { const f = fields.find((x) => x.key === e.target.value); set({ groupBy: { field: e.target.value, ...(['date', 'datetime'].includes(f?.type) ? { interval: 'month' } : {}) } }); }}>
                      {groupFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
                    </TextField>
                    {isDate && (
                      <TextField select label="By" value={config.groupBy.interval ?? 'month'} sx={{ minWidth: 120 }} onChange={(e) => set({ groupBy: { ...config.groupBy, interval: e.target.value } })}>
                        {INTERVALS.map((v) => <MenuItem key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</MenuItem>)}
                      </TextField>
                    )}
                  </Stack>
                </Stack>
              )}
              {type === 'list' && (
                <Stack spacing={2}>
                  <Autocomplete
                    multiple options={fields.filter((f) => f.visibility.list)} getOptionLabel={(f) => f.label} isOptionEqualToValue={(a, b) => a.key === b.key}
                    value={(config.columns ?? []).map((k) => fields.find((f) => f.key === k)).filter(Boolean)}
                    onChange={(_e, v) => set({ columns: v.slice(0, 5).map((f) => f.key) })} renderInput={(p) => <TextField {...p} label="Columns (up to 5)" />}
                  />
                  <Stack direction="row" spacing={1.5}>
                    <TextField select label="Sort by" fullWidth value={(config.sort ?? 'createdAt:desc').split(':')[0]} onChange={(e) => set({ sort: `${e.target.value}:${(config.sort ?? 'createdAt:desc').split(':')[1]}` })}>
                      {[...fields.filter((f) => !['multiselect', 'textarea', 'location'].includes(f.type)), { key: 'createdAt', label: 'Created' }, { key: 'updatedAt', label: 'Last updated' }].map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
                    </TextField>
                    <TextField select label="Order" fullWidth value={(config.sort ?? 'createdAt:desc').split(':')[1]} onChange={(e) => set({ sort: `${(config.sort ?? 'createdAt:desc').split(':')[0]}:${e.target.value}` })}>
                      <MenuItem value="asc">Ascending</MenuItem><MenuItem value="desc">Descending</MenuItem>
                    </TextField>
                    <TextField label="Rows" type="number" value={config.limit ?? 8} onChange={(e) => set({ limit: Math.max(1, Math.min(20, Number(e.target.value) || 8)) })} sx={{ width: 100 }} />
                  </Stack>
                </Stack>
              )}
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" color="inherit" startIcon={<FilterIcon />} onClick={() => setFilterOpen(true)}>Filters{countConditions(config.filter) ? ` (${countConditions(config.filter)})` : ''}</Button>
                {countConditions(config.filter) > 0 && <Button size="small" onClick={() => set({ filter: null })}>Clear</Button>}
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={() => onSave({ ...(widget?.id ? { id: widget.id } : {}), type, title: title.trim(), w, h, config: Object.fromEntries(Object.entries(config).filter(([, v]) => v !== null && v !== undefined)) })}>
          {editing ? 'Apply' : 'Add widget'}
        </Button>
      </DialogActions>
      {filterOpen && <FilterBuilder open fields={fields} draft={deserialize(config.filter, fields)} onClose={() => setFilterOpen(false)} onApply={(tree) => { set({ filter: tree }); setFilterOpen(false); }} />}
    </Dialog>
  );
}

import { useState } from 'react';
import { Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import AddIcon from '@mui/icons-material/AddRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import dayjs from 'dayjs';
import { RecordPicker } from './FieldInput';
import { NO_VALUE_OPERATORS, OPERATOR_LABELS, groupOf, operatorsFor } from './fieldUtils';

const MAX_DEPTH = 3;
let uid = 0;
const newCondition = (fields) => ({ id: ++uid, field: fields[0]?.key ?? '', operator: operatorsFor(fields[0]?.type ?? 'text')[0], value: '' });
const newGroup = (fields) => ({ id: ++uid, op: 'and', conditions: [newCondition(fields)] });

const BUILTIN = [
  { key: 'createdAt', label: 'Created', type: 'datetime', options: [], config: {} },
  { key: 'updatedAt', label: 'Last updated', type: 'datetime', options: [], config: {} },
];

// Draft tree (with ids / raw strings) -> API filter tree. Incomplete conditions are dropped.
export function serialize(node, fieldsByKey) {
  if (node.conditions) {
    const conditions = node.conditions.map((c) => serialize(c, fieldsByKey)).filter(Boolean);
    return conditions.length ? { op: node.op, conditions } : null;
  }
  const f = fieldsByKey[node.field];
  if (!f) return null;
  if (NO_VALUE_OPERATORS.has(node.operator)) return { field: node.field, operator: node.operator };
  const conv = (v) => {
    if (f.type === 'integer' || f.type === 'decimal' || node.operator === 'inLastDays' || node.operator === 'inNextDays') return v === '' ? null : Number(v);
    if (f.type === 'datetime') return v ? new Date(v).toISOString() : null;
    return v === '' ? null : v;
  };
  let value;
  if (Array.isArray(node.value)) value = node.value.map(conv);
  else value = conv(node.value);
  if (node.operator === 'between') {
    if (!Array.isArray(value) || value.length !== 2 || value.some((v) => v === null)) return null;
  } else if (value === null || (Array.isArray(value) && value.length === 0)) return null;
  return { field: node.field, operator: node.operator, value };
}

// API filter tree -> editable draft tree (the inverse of serialize), used when a saved filter is re-opened.
export function deserialize(node, fields) {
  if (!node) return null;
  if (node.conditions) return { id: ++uid, op: node.op, conditions: node.conditions.map((c) => deserialize(c, fields)) };
  const f = [...fields, ...BUILTIN].find((x) => x.key === node.field);
  const local = (v) => (f?.type === 'datetime' && v ? dayjs(v).format('YYYY-MM-DDTHH:mm') : typeof v === 'number' ? String(v) : (v ?? ''));
  return { id: ++uid, field: node.field, operator: node.operator, value: Array.isArray(node.value) ? node.value.map(local) : local(node.value) };
}

export const countConditions = (node) => (node?.conditions ? node.conditions.reduce((n, c) => n + countConditions(c), 0) : node ? 1 : 0);

function ValueInput({ field, cond, onChange }) {
  const { operator, value } = cond;
  if (NO_VALUE_OPERATORS.has(operator)) return null;
  const common = { size: 'small', sx: { minWidth: 160, flex: 1 } };
  const type = field.type;
  const g = groupOf(type);

  if (operator === 'between') {
    const [a = '', b = ''] = Array.isArray(value) ? value : [];
    const t = g === 'date' ? 'date' : g === 'datetime' ? 'datetime-local' : 'number';
    const shrink = t !== 'number' ? { inputLabel: { shrink: true } } : undefined;
    return (
      <Stack direction="row" spacing={1} sx={{ flex: 1 }}>
        <TextField {...common} type={t} value={a} onChange={(e) => onChange([e.target.value, b])} slotProps={shrink} />
        <TextField {...common} type={t} value={b} onChange={(e) => onChange([a, e.target.value])} slotProps={shrink} />
      </Stack>
    );
  }
  if (operator === 'inLastDays' || operator === 'inNextDays') return <TextField {...common} type="number" value={value} onChange={(e) => onChange(e.target.value)} slotProps={{ htmlInput: { min: 0 } }} />;
  if (g === 'choice' || g === 'multi') {
    const multi = g === 'multi' || operator === 'in' || operator === 'notIn';
    if (!multi) {
      return <TextField {...common} select value={value} onChange={(e) => onChange(e.target.value)}>{field.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}</TextField>;
    }
    return (
      <Autocomplete
        multiple size="small" sx={{ minWidth: 200, flex: 1 }} options={field.options.map((o) => o.value)} value={Array.isArray(value) ? value : []}
        getOptionLabel={(v) => field.options.find((o) => o.value === v)?.label ?? v} onChange={(_e, v) => onChange(v)} renderInput={(p) => <TextField {...p} />}
      />
    );
  }
  if (g === 'relationship') {
    return (
      <Box sx={{ minWidth: 200, flex: 1 }}>
        <RecordPicker size="small" targetDataformId={field.config?.targetDataform} value={Array.isArray(value) ? value[0] : value} onChange={(v) => onChange(operator === 'in' ? (v ? [v] : []) : v)} label="Record" />
      </Box>
    );
  }
  const t = g === 'number' ? 'number' : g === 'date' ? 'date' : g === 'datetime' ? 'datetime-local' : 'text';
  return <TextField {...common} type={t} value={value} onChange={(e) => onChange(e.target.value)} slotProps={t === 'date' || t === 'datetime-local' ? { inputLabel: { shrink: true } } : undefined} />;
}

function ConditionRow({ cond, fields, onChange, onRemove }) {
  const field = fields.find((f) => f.key === cond.field) ?? fields[0];
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <TextField select size="small" value={cond.field} sx={{ minWidth: 150 }} onChange={(e) => {
        const f = fields.find((x) => x.key === e.target.value);
        onChange({ ...cond, field: f.key, operator: operatorsFor(f.type)[0], value: '' });
      }} slotProps={{ htmlInput: { 'aria-label': 'Field' } }}>
        {fields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
      </TextField>
      <TextField select size="small" value={cond.operator} sx={{ minWidth: 150 }} onChange={(e) => onChange({ ...cond, operator: e.target.value, value: e.target.value === 'between' || e.target.value === 'in' || e.target.value === 'notIn' ? [] : '' })} slotProps={{ htmlInput: { 'aria-label': 'Operator' } }}>
        {operatorsFor(field.type).map((o) => <MenuItem key={o} value={o}>{OPERATOR_LABELS[o]}</MenuItem>)}
      </TextField>
      <ValueInput field={field} cond={cond} onChange={(value) => onChange({ ...cond, value })} />
      <IconButton size="small" aria-label="Remove condition" onClick={onRemove}><CloseIcon fontSize="small" /></IconButton>
    </Stack>
  );
}

function GroupEditor({ group, fields, depth, onChange, onRemove }) {
  const set = (i, node) => onChange({ ...group, conditions: group.conditions.map((c, j) => (j === i ? node : c)) });
  const del = (i) => onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) });
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5, bgcolor: depth % 2 ? 'action.hover' : 'transparent' }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
        <ToggleButtonGroup size="small" exclusive value={group.op} onChange={(_e, v) => v && onChange({ ...group, op: v })} aria-label="Match mode">
          <ToggleButton value="and">Match all</ToggleButton><ToggleButton value="or">Match any</ToggleButton>
        </ToggleButtonGroup>
        {onRemove && <Button size="small" color="inherit" onClick={onRemove}>Remove group</Button>}
      </Stack>
      <Stack spacing={1.5}>
        {group.conditions.map((c, i) => (c.conditions
          ? <GroupEditor key={c.id} group={c} fields={fields} depth={depth + 1} onChange={(n) => set(i, n)} onRemove={() => del(i)} />
          : <ConditionRow key={c.id} cond={c} fields={fields} onChange={(n) => set(i, n)} onRemove={() => del(i)} />))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" startIcon={<AddIcon />} onClick={() => onChange({ ...group, conditions: [...group.conditions, newCondition(fields)] })}>Add condition</Button>
        {depth < MAX_DEPTH && <Button size="small" startIcon={<AddIcon />} onClick={() => onChange({ ...group, conditions: [...group.conditions, newGroup(fields)] })}>Add group</Button>}
      </Stack>
    </Box>
  );
}

export default function FilterBuilder({ open, fields, draft, onApply, onClose }) {
  const all = [...fields.filter((f) => f.visibility.list), ...BUILTIN];
  const [tree, setTree] = useState(() => draft ?? { id: ++uid, op: 'and', conditions: [newCondition(all)] });
  const byKey = Object.fromEntries(all.map((f) => [f.key, f]));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Filter records</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <GroupEditor group={tree} fields={all} depth={1} onChange={setTree} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={() => { setTree({ id: ++uid, op: 'and', conditions: [] }); onApply(null, null); }}>Clear all</Button>
        <Box sx={{ flex: 1 }} />
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onApply(serialize(tree, byKey), tree)}>Apply filters</Button>
      </DialogActions>
    </Dialog>
  );
}

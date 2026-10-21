import { Box, Button, IconButton, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, MenuItem } from '@mui/material';
import AddIcon from '@mui/icons-material/AddRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { ConditionRow, deserialize, serialize } from '../records/FilterBuilder';
import { operatorsFor } from '../records/fieldUtils';
import FormulaField from './FormulaField';

const id = () => Math.random().toString(36).slice(2);
const MAX_DEPTH = 3;

export const emptyGroup = () => ({ id: id(), kind: 'group', op: 'and', conditions: [] });

// API tree -> editable draft (adds ids, turns stored values into form values).
export function toDraft(node, fields) {
  if (!node) return emptyGroup();
  if (node.conditions) return { id: id(), kind: 'group', op: node.op, conditions: node.conditions.map((c) => toDraft(c, fields)) };
  if (node.kind === 'formula') return { id: id(), kind: 'formula', expression: node.expression };
  if (node.kind === 'changed') return { id: id(), kind: 'changed', field: node.field };
  return { ...deserialize({ field: node.field, operator: node.operator, value: node.value }, fields), kind: 'field' };
}

// Draft -> API tree. Incomplete conditions are dropped; an empty tree becomes null.
export function toApi(node, fields) {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const walk = (n) => {
    if (n.conditions) {
      const conditions = n.conditions.map(walk).filter(Boolean);
      return conditions.length ? { kind: 'group', op: n.op, conditions } : null;
    }
    if (n.kind === 'formula') return n.expression?.trim() ? { kind: 'formula', expression: n.expression.trim() } : null;
    if (n.kind === 'changed') return n.field ? { kind: 'changed', field: n.field } : null;
    const leaf = serialize(n, byKey);
    return leaf ? { kind: 'field', ...leaf } : null;
  };
  return walk(node);
}

function Group({ group, fields, dataformId, depth, allowChanged, onChange, onRemove }) {
  const first = fields[0];
  const set = (i, node) => onChange({ ...group, conditions: group.conditions.map((c, j) => (j === i ? node : c)) });
  const del = (i) => onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) });
  const add = (node) => onChange({ ...group, conditions: [...group.conditions, node] });
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5, bgcolor: depth % 2 ? 'action.hover' : 'transparent' }}>
      <Stack direction="row" sx={{ mb: 1.5, justifyContent: 'space-between', alignItems: 'center' }}>
        <ToggleButtonGroup size="small" exclusive value={group.op} onChange={(_e, v) => v && onChange({ ...group, op: v })} aria-label="Match mode">
          <ToggleButton value="and">Match all</ToggleButton><ToggleButton value="or">Match any</ToggleButton>
        </ToggleButtonGroup>
        {onRemove && <Button size="small" color="inherit" onClick={onRemove}>Remove group</Button>}
      </Stack>
      <Stack spacing={1.5}>
        {group.conditions.length === 0 && <Typography variant="body2" color="text.secondary">No conditions: the workflow runs for every record.</Typography>}
        {group.conditions.map((c, i) => {
          if (c.conditions) return <Group key={c.id} group={c} fields={fields} dataformId={dataformId} depth={depth + 1} allowChanged={allowChanged} onChange={(n) => set(i, n)} onRemove={() => del(i)} />;
          if (c.kind === 'formula') {
            return (
              <Stack key={c.id} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1 }}><FormulaField label="Formula is true" value={c.expression} fields={fields} dataformId={dataformId} onChange={(expression) => set(i, { ...c, expression })} /></Box>
                <IconButton size="small" aria-label="Remove condition" onClick={() => del(i)}><CloseIcon fontSize="small" /></IconButton>
              </Stack>
            );
          }
          if (c.kind === 'changed') {
            return (
              <Stack key={c.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ minWidth: 60 }}>Field</Typography>
                <TextField select size="small" value={c.field} onChange={(e) => set(i, { ...c, field: e.target.value })} sx={{ minWidth: 200 }} slotProps={{ htmlInput: { 'aria-label': 'Changed field' } }}>
                  {fields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
                </TextField>
                <Typography variant="body2">was changed by this save</Typography>
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" aria-label="Remove condition" onClick={() => del(i)}><CloseIcon fontSize="small" /></IconButton>
              </Stack>
            );
          }
          return <ConditionRow key={c.id} cond={c} fields={fields} onChange={(n) => set(i, n)} onRemove={() => del(i)} />;
        })}
      </Stack>
      <Stack direction="row" sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Button size="small" startIcon={<AddIcon />} disabled={!first} onClick={() => add({ id: id(), kind: 'field', field: first.key, operator: operatorsFor(first.type)[0], value: '' })}>Field condition</Button>
        <Button size="small" startIcon={<AddIcon />} onClick={() => add({ id: id(), kind: 'formula', expression: '' })}>Formula</Button>
        {allowChanged && <Button size="small" startIcon={<AddIcon />} disabled={!first} onClick={() => add({ id: id(), kind: 'changed', field: first.key })}>Field changed</Button>}
        {depth < MAX_DEPTH && <Button size="small" startIcon={<AddIcon />} onClick={() => add(emptyGroup())}>Group</Button>}
      </Stack>
    </Box>
  );
}

export default function ConditionTree({ value, fields, dataformId, allowChanged, onChange }) {
  return <Group group={value} fields={fields} dataformId={dataformId} depth={1} allowChanged={allowChanged} onChange={onChange} />;
}

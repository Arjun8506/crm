import { useState } from 'react';
import { Alert, Box, Button, Chip, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import { RecordPicker } from '../records/FieldInput';
import { useTestFormulaMutation } from './automationApi';

const FUNCTIONS = 'IF, AND, OR, NOT, ISEMPTY, COALESCE, IN, CONCAT, LEN, LOWER, UPPER, TRIM, CONTAINS, STARTSWITH, ROUND, FLOOR, CEIL, ABS, MIN, MAX, SUM, NUMBER, TEXT, NOW, TODAY, DATE, ADDDAYS, DATEDIFF, ISCHANGED';

// Inserts {field_key} / {{field_key}} chips for the dataform's fields.
export function FieldChips({ fields, wrap = '{}', onInsert }) {
  const open = wrap === '{}' ? (k) => `{${k}}` : (k) => `{{${k}}}`;
  const items = [...fields.slice(0, 14).map((f) => [f.key, f.label]), ...(wrap === '{}' ? [['old.' + (fields[0]?.key ?? 'field'), 'previous value'], ['record.label', 'record name']] : [['record.label', 'record name'], ['record.url', 'record link'], ['user.name', 'my name']])];
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
      {items.map(([k, label]) => (
        <Tooltip key={k} title={`Insert ${open(k)}`}>
          <Chip size="small" variant="outlined" label={label} onClick={() => onInsert(open(k))} />
        </Tooltip>
      ))}
    </Stack>
  );
}

export function TemplateField({ label, value, onChange, fields, minRows = 1, error, helperText }) {
  return (
    <Box>
      <TextField fullWidth multiline minRows={minRows} label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} error={!!error} helperText={error || helperText || 'Use {{field_key}} to insert values from the record.'} />
      <FieldChips fields={fields} wrap="{{}}" onInsert={(token) => onChange(`${value ?? ''}${token}`)} />
    </Box>
  );
}

// A formula input with a "Test" button that evaluates it against a real record (or shows exactly what is wrong).
export default function FormulaField({ label = 'Formula', value, onChange, fields, dataformId, error, helperText }) {
  const [anchor, setAnchor] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [test, { data, isLoading, reset }] = useTestFormulaMutation();

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          fullWidth multiline minRows={1} label={label} value={value ?? ''} onChange={(e) => { onChange(e.target.value); reset(); }} error={!!error}
          helperText={error || helperText || 'e.g. IF({value} > 5000, "big", "small"). Reference fields as {field_key}.'} slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13 } } }}
        />
        <Button size="small" variant="outlined" startIcon={<ScienceIcon />} onClick={(e) => setAnchor(e.currentTarget)} sx={{ mt: 0.5, flexShrink: 0 }}>Test</Button>
      </Stack>
      <FieldChips fields={fields} onInsert={(token) => onChange(`${value ?? ''}${token}`)} />
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { p: 2, width: 380, maxWidth: '95vw' } } }}>
        <Stack spacing={1.5}>
          <Typography fontWeight={600}>Test this formula</Typography>
          <RecordPicker targetDataformId={dataformId} value={recordId} onChange={setRecordId} label="Sample record (optional)" size="small" />
          <Button variant="contained" disabled={!value?.trim() || isLoading} onClick={() => test({ dataformId, expression: value, ...(recordId ? { recordId } : { sample: {} }) })}>Run</Button>
          {data && (data.ok
            ? <Alert severity="success"><b>Result:</b> {data.result === null ? '(empty)' : String(data.result)} <Typography variant="caption" component="span" color="text.secondary">({data.type})</Typography></Alert>
            : <Alert severity="error">{data.error}</Alert>)}
          <Typography variant="caption" color="text.secondary">Functions: {FUNCTIONS}. Operators: + - * / % & (join text) = != &lt; &lt;= &gt; &gt;= && || !</Typography>
        </Stack>
      </Popover>
    </Box>
  );
}

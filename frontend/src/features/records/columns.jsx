import { Chip, Link, Stack, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { formatValue, optionLabel } from './fieldUtils';

const UNSORTABLE = new Set(['multiselect', 'textarea']);
const WIDTH = { textarea: 240, url: 200, email: 220, datetime: 170, date: 130, boolean: 100, integer: 120, decimal: 120, relationship: 180 };

export function buildColumns(fields, refs) {
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
        case 'location': return formatValue(f, value);
        case 'url': return <Link href={value} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{value.replace(/^https?:\/\//, '')}</Link>;
        case 'email': return <Link href={`mailto:${value}`} onClick={(e) => e.stopPropagation()}>{value}</Link>;
        default: return formatValue(f, value);
      }
    },
  }));
  cols.push({ field: 'updatedAt', headerName: 'Updated', width: 150, valueGetter: (_v, row) => row.updatedAt, valueFormatter: (v) => dayjs(v).format('MMM D, YYYY') });
  return cols;
}

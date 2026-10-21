import { useState } from 'react';
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import dayjs from 'dayjs';
import ChevronLeft from '@mui/icons-material/ChevronLeftRounded';
import ChevronRight from '@mui/icons-material/ChevronRightRounded';
import EventIcon from '@mui/icons-material/EventOutlined';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useQueryRecordsQuery } from '../records/recordsApi';

const MAX_PER_DAY = 3;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const startOfWeek = (d) => d.subtract((d.day() + 6) % 7, 'day').startOf('day');

export default function CalendarView({ dataform, fields, query, config, onConfig, onOpen }) {
  const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
  const dateField = dateFields.find((f) => f.key === config.dateField) ?? dateFields[0];
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const [dayList, setDayList] = useState(null);

  const gridStart = startOfWeek(month);
  const weeks = Math.ceil((month.daysInMonth() + (month.day() + 6) % 7) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => gridStart.add(i, 'day'));
  const first = days[0];
  const last = days[days.length - 1];
  const range = dateField?.type === 'date'
    ? [first.format('YYYY-MM-DD'), last.format('YYYY-MM-DD')]
    : [first.toISOString(), last.endOf('day').toISOString()];

  const inRange = dateField && { field: dateField.key, operator: 'between', value: range };
  const filter = inRange ? { op: 'and', conditions: [inRange, ...(query.filter ? [query.filter] : [])] } : undefined;
  const { data, error, refetch, isFetching } = useQueryRecordsQuery(
    { dataformId: dataform._id, page: 1, limit: 200, q: query.q || undefined, filter, sort: `${dateField?.key}:asc` }, { skip: !dateField },
  );

  const byDay = {};
  for (const r of dateField ? data?.data ?? [] : []) {
    const v = r.data?.[dateField.key];
    if (!v) continue;
    (byDay[dateField.type === 'date' ? v : dayjs(v).format('YYYY-MM-DD')] ??= []).push(r);
  }

  if (!dateField) return <EmptyState icon={<EventIcon />} title="No date field available" description="The calendar places records on a date or date & time field. Add one in the dataform settings first." />;
  const today = dayjs().format('YYYY-MM-DD');

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <IconButton aria-label="Previous month" onClick={() => setMonth(month.subtract(1, 'month'))}><ChevronLeft /></IconButton>
        <Typography variant="h6" sx={{ minWidth: 160, textAlign: 'center' }} aria-live="polite">{month.format('MMMM YYYY')}</Typography>
        <IconButton aria-label="Next month" onClick={() => setMonth(month.add(1, 'month'))}><ChevronRight /></IconButton>
        <Button size="small" onClick={() => setMonth(dayjs().startOf('month'))}>Today</Button>
        <Box sx={{ flex: 1 }} />
        {dateFields.length > 1 && (
          <TextField select size="small" label="Date field" value={dateField.key} onChange={(e) => onConfig({ dateField: e.target.value })} sx={{ minWidth: 180 }}>
            {dateFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
        )}
      </Stack>
      {error ? <ErrorState message={errorMessage(error, 'Could not load the calendar')} onRetry={refetch} /> : (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', opacity: isFetching ? 0.7 : 1, transition: 'opacity 150ms' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', bgcolor: 'action.hover' }}>
            {DAYS.map((d) => <Typography key={d} variant="caption" fontWeight={600} color="text.secondary" sx={{ p: 1, textAlign: 'center' }}>{d}</Typography>)}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }} role="grid" aria-label={month.format('MMMM YYYY')}>
            {days.map((d) => {
              const key = d.format('YYYY-MM-DD');
              const items = byDay[key] ?? [];
              const outside = d.month() !== month.month();
              return (
                <Box key={key} role="gridcell" sx={{ minHeight: 112, p: 0.75, borderTop: 1, borderLeft: 1, borderColor: 'divider', bgcolor: outside ? 'action.hover' : 'transparent', minWidth: 0 }}>
                  <Typography variant="caption" sx={{ display: 'inline-grid', placeItems: 'center', width: 24, height: 24, borderRadius: '50%', ...(key === today ? { bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 700 } : { color: outside ? 'text.disabled' : 'text.secondary' }) }}>{d.date()}</Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {items.slice(0, MAX_PER_DAY).map((r) => (
                      <Chip key={r._id} size="small" label={r._label} onClick={() => onOpen(r._id)} color="primary" variant="outlined" sx={{ justifyContent: 'flex-start', maxWidth: '100%', borderRadius: 1 }} />
                    ))}
                    {items.length > MAX_PER_DAY && <Button size="small" onClick={() => setDayList({ day: d, items })} sx={{ justifyContent: 'flex-start', minWidth: 0, py: 0 }}>+{items.length - MAX_PER_DAY} more</Button>}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      {data && data.total > 200 && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Showing the first 200 of {data.total} records in this range.</Typography>}
      <Dialog open={!!dayList} onClose={() => setDayList(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{dayList?.day.format('dddd, MMMM D')}</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ pt: 1 }}>
            {dayList?.items.map((r) => <Button key={r._id} variant="outlined" sx={{ justifyContent: 'flex-start' }} onClick={() => { setDayList(null); onOpen(r._id); }}>{r._label}</Button>)}
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  );
}

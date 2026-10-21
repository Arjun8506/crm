import { Box, Card, CardActionArea, Chip, Pagination, Skeleton, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import TableIcon from '@mui/icons-material/GridViewRounded';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { formatValue } from '../records/fieldUtils';
import { useQueryRecordsQuery } from '../records/recordsApi';

const PAGE = 24;

export function CardValue({ field, value, refs }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return <Typography variant="body2" color="text.disabled">-</Typography>;
  if (field.type === 'dropdown') return <Chip size="small" label={formatValue(field, value)} />;
  if (field.type === 'multiselect') return <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>{value.map((v) => <Chip key={v} size="small" variant="outlined" label={formatValue({ ...field, type: 'dropdown' }, v)} />)}</Stack>;
  if (field.type === 'relationship') return <Typography variant="body2">{refs?.[field.key]?.[value] ?? 'Unknown record'}</Typography>;
  return <Typography variant="body2" noWrap>{formatValue(field, value)}</Typography>;
}

export default function CardsView({ dataform, fields, query, config, onOpen }) {
  const [page, setPage] = useState(1);
  const listFields = fields.filter((f) => f.visibility.list);
  const shown = (config.cardFields?.length ? config.cardFields.map((k) => listFields.find((f) => f.key === k)).filter(Boolean) : listFields.filter((f) => f.key !== dataform.primaryField).slice(0, 4));
  const args = { dataformId: dataform._id, page, limit: PAGE, q: query.q || undefined, filter: query.filter || undefined, sort: query.sort || 'updatedAt:desc' };
  const { data, isFetching, error, refetch } = useQueryRecordsQuery(args);

  if (error) return <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error, 'Could not load records')} onRetry={refetch} /></Box>;
  if (!data) return <Box sx={{ p: 2, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} variant="rounded" height={150} />)}</Box>;
  if (!data.data.length) return <EmptyState icon={<TableIcon />} title="No records match" description="Try changing or clearing your search and filters." />;

  return (
    <Box sx={{ p: 2, opacity: isFetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {data.data.map((r) => (
          <Card key={r._id}>
            <CardActionArea onClick={() => onOpen(r._id)} sx={{ p: 2, height: '100%', alignItems: 'flex-start' }}>
              <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ mb: 1 }}>{r._label}</Typography>
              <Stack spacing={1}>
                {shown.map((f) => (
                  <Box key={f.key}>
                    <Typography variant="caption" color="text.secondary">{f.label}</Typography>
                    <CardValue field={f} value={r.data?.[f.key]} refs={data.refs} />
                  </Box>
                ))}
              </Stack>
            </CardActionArea>
          </Card>
        ))}
      </Box>
      {data.total > PAGE && (
        <Stack sx={{ alignItems: 'center', mt: 3 }}>
          <Pagination count={Math.ceil(data.total / PAGE)} page={page} onChange={(_e, p) => setPage(p)} />
        </Stack>
      )}
    </Box>
  );
}

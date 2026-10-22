import { Box, Divider, Link, Skeleton, Stack, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useGetPublicShareQuery } from '../dataops/dataopsApi';
import PublicLayout from './PublicLayout';

const label = (f, v) => f.options.find((o) => o.value === v)?.label ?? v;
const safeUrl = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };

function Value({ field }) {
  const v = field.value;
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return <Typography color="text.disabled">—</Typography>;
  switch (field.type) {
    case 'boolean': return <Typography>{v ? 'Yes' : 'No'}</Typography>;
    case 'dropdown': return <Typography>{label(field, v)}</Typography>;
    case 'multiselect': return <Typography>{v.map((x) => label(field, x)).join(', ')}</Typography>;
    case 'datetime': return <Typography>{dayjs(v).format('D MMM YYYY, HH:mm')}</Typography>;
    case 'date': return <Typography>{dayjs(v).format('D MMM YYYY')}</Typography>;
    case 'location': return <Typography>{v.lat}, {v.lng}</Typography>;
    case 'url': return safeUrl(v) ? <Link href={safeUrl(v)} target="_blank" rel="noopener noreferrer nofollow">{v}</Link> : <Typography>{v}</Typography>;
    default: return <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(v)}</Typography>;
  }
}

export default function PublicSharePage() {
  const { token } = useParams();
  const { data, isLoading, error } = useGetPublicShareQuery(token);
  if (isLoading) return <PublicLayout><Skeleton variant="rounded" height={220} /></PublicLayout>;
  if (error || !data) {
    return (
      <PublicLayout title="Link not available">
        <Stack spacing={1} sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h5" component="h1">This link is not available</Typography>
          <Typography color="text.secondary">It may have expired or been withdrawn. Please ask the person who sent it for a new one.</Typography>
        </Stack>
      </PublicLayout>
    );
  }
  return (
    <PublicLayout title={data.title}>
      <Typography variant="overline" color="text.secondary">{data.dataformName}</Typography>
      <Typography variant="h5" component="h1" sx={{ overflowWrap: 'anywhere' }}>{data.title}</Typography>
      <Stack divider={<Divider />} spacing={1.5} sx={{ mt: 2.5 }}>
        {data.fields.map((f) => (
          <Box key={f.key}>
            <Typography variant="caption" color="text.secondary">{f.label}</Typography>
            <Value field={f} />
          </Box>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>Read-only. This link expires on {dayjs(data.expiresAt).format('D MMM YYYY')}.</Typography>
    </PublicLayout>
  );
}

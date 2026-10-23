import { useEffect } from 'react';
import { Box, Card, Chip, Skeleton, Stack, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { EmptyState, PageHeader, PageTransition } from '../../components/common';
import { useGetNewsQuery, useMarkNewsSeenMutation } from './businessApi';

export default function WhatsNewPage() {
  const { data, isLoading } = useGetNewsQuery();
  const [seen] = useMarkNewsSeenMutation();
  // Opening the page counts as reading it. The unread dots in this render still show what was new.
  useEffect(() => { if (data && data.unread > 0) { const t = setTimeout(() => seen(), 1500); return () => clearTimeout(t); } return undefined; }, [data, seen]);
  return (
    <PageTransition>
      <PageHeader title="What’s new" description="Product updates and announcements from your organisation." />
      {isLoading ? <Skeleton variant="rounded" height={200} /> : !data.data.length ? <Card><EmptyState title="Nothing yet" /></Card> : (
        <Stack spacing={2} sx={{ maxWidth: 760 }}>
          {data.data.map((i) => (
            <Card key={`${i.kind}-${i.id}`} sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
                <Chip size="small" variant="outlined" color={i.kind === 'organisation' ? 'primary' : 'default'} label={i.kind === 'organisation' ? 'Your organisation' : 'Product'} />
                {i.unread && <Chip size="small" color="primary" label="New" />}
                <Typography variant="caption" color="text.secondary">{dayjs(i.date).format('D MMM YYYY')}{i.author ? ` · ${i.author}` : ''}</Typography>
              </Stack>
              <Typography variant="h6" component="h2">{i.title}</Typography>
              {i.body && <Box component="p" sx={{ m: 0, mt: 0.5, color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{i.body}</Box>}
            </Card>
          ))}
        </Stack>
      )}
    </PageTransition>
  );
}

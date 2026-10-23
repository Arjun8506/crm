import { Box, Button, Card, Collapse, IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import CheckIcon from '@mui/icons-material/CheckCircleRounded';
import EmptyCircle from '@mui/icons-material/RadioButtonUncheckedRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { useDismissChecklistMutation, useGetOnboardingQuery } from './businessApi';

// A short list of next steps, ticked off from what really exists in the account. Anyone can hide it.
export default function OnboardingChecklist() {
  const { data } = useGetOnboardingQuery();
  const [dismiss] = useDismissChecklistMutation();
  if (!data || data.setupNeeded) return null;
  const finished = data.doneCount === data.total;
  return (
    <Collapse in={!data.dismissedAt && !finished} unmountOnExit>
      <Card sx={{ p: 2.5, mb: 3 }} component="section" aria-label="Getting started">
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="h6">Getting started</Typography>
            <Typography variant="body2" color="text.secondary">{data.doneCount} of {data.total} done</Typography>
          </Box>
          <Tooltip title="Hide this list. You can bring it back from Help."><IconButton size="small" aria-label="Hide getting started list" onClick={() => dismiss()}><CloseIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
        <LinearProgress variant="determinate" value={(data.doneCount / data.total) * 100} sx={{ my: 1.5, height: 6, borderRadius: 3 }} aria-label="Setup progress" />
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          {data.steps.map((s) => (
            <Stack key={s.id} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
              {s.done ? <CheckIcon color="success" fontSize="small" sx={{ mt: 0.25 }} aria-label="Done" /> : <EmptyCircle fontSize="small" sx={{ mt: 0.25, color: 'text.disabled' }} aria-label="Not done" />}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={500} sx={{ textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'text.secondary' : 'text.primary' }}>{s.title}</Typography>
                {!s.done && <Typography variant="caption" color="text.secondary">{s.description}</Typography>}
              </Box>
              {!s.done && s.canDo && <Button size="small" component={RouterLink} to={s.link}>Go</Button>}
            </Stack>
          ))}
        </Box>
      </Card>
    </Collapse>
  );
}

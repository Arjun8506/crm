import { Alert, Box, Button, Card, Skeleton, Stack, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { useCompleteTestCheckoutMutation, useGetCheckoutQuery, useListPlansQuery } from './billingApi';

// Stands in for the payment provider's hosted page while billing runs in test mode. It asks for no card details.
// Pressing a button sends the same kind of signed confirmation a real provider would; the plan only changes after the server verifies it.
export default function TestCheckoutPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { data: session, isLoading, error } = useGetCheckoutQuery(sessionId);
  const { data: plans } = useListPlansQuery();
  const [complete, { isLoading: busy }] = useCompleteTestCheckoutMutation();
  const plan = plans?.plans.find((p) => p.id === session?.plan);

  const finish = async (outcome) => {
    try {
      await complete({ sessionId, outcome }).unwrap();
      navigate(`/settings/billing?checkout=${outcome === 'succeeded' ? 'success' : 'cancelled'}`);
    } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };

  return (
    <PageTransition>
      <PageHeader title="Test checkout" description="This page simulates a payment provider. No real payment happens." />
      {error ? <ErrorState message={errorMessage(error, 'This checkout was not found')} /> : isLoading || !plan ? <Skeleton variant="rounded" height={220} /> : (
        <Card sx={{ p: 3, maxWidth: 520 }}>
          <Stack spacing={2}>
            <Alert severity="warning">Test mode. There is no card form here on purpose: this server never sees card details.</Alert>
            <Box>
              <Typography variant="overline" color="text.secondary">You are buying</Typography>
              <Typography variant="h5">{plan.name} plan</Typography>
              <Typography color="text.secondary">${(plan.priceMonthly / 100).toFixed(2)} per month</Typography>
            </Box>
            {session.status !== 'pending' ? <Alert severity="info">This checkout has already finished ({session.status}).</Alert> : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button variant="contained" disabled={busy} onClick={() => finish('succeeded')}>Simulate a successful payment</Button>
                <Button color="error" variant="outlined" disabled={busy} onClick={() => finish('failed')}>Simulate a failed payment</Button>
              </Stack>
            )}
            <Button color="inherit" onClick={() => navigate('/settings/billing')}>Back to billing</Button>
          </Stack>
        </Card>
      )}
    </PageTransition>
  );
}

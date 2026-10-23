import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import CheckIcon from '@mui/icons-material/CheckRounded';
import RemoveIcon from '@mui/icons-material/RemoveRounded';
import { ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { selectCan } from '../auth/authSlice';
import { showToast } from '../ui/uiSlice';
import {
  useChangePlanMutation, useGetBillingQuery, useLazyPreviewChangeQuery, useListPlansQuery, useResumePlanMutation, useStartCheckoutMutation,
} from './billingApi';

const money = (cents, currency = 'usd') => (cents === 0 ? 'Free' : new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100));
const RANK = { free: 0, team: 1, business: 2 };
const fmt = (v) => (typeof v === 'boolean' ? (v ? <CheckIcon fontSize="small" color="success" aria-label="Included" /> : <RemoveIcon fontSize="small" sx={{ color: 'text.disabled' }} aria-label="Not included" />) : v === 0 ? <RemoveIcon fontSize="small" sx={{ color: 'text.disabled' }} aria-label="Not included" /> : v.toLocaleString('en-US'));

function Meter({ m }) {
  const high = m.percent >= 90;
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="body2">{m.label}</Typography>
        <Typography variant="body2" color={high ? 'error' : 'text.secondary'}>{m.used.toLocaleString('en-US')} of {m.limit.toLocaleString('en-US')}</Typography>
      </Stack>
      <LinearProgress variant="determinate" value={m.percent} color={high ? 'error' : m.percent >= 70 ? 'warning' : 'primary'} sx={{ mt: 0.75, height: 8, borderRadius: 4 }} aria-label={`${m.label} used`} />
    </Box>
  );
}

function DowngradeDialog({ target, plans, onClose, onDone }) {
  const dispatch = useDispatch();
  const [preview, { data, isFetching }] = useLazyPreviewChangeQuery();
  const [change, { isLoading }] = useChangePlanMutation();
  useEffect(() => { if (target) preview(target); }, [target, preview]);
  const name = plans.find((p) => p.id === target)?.name;
  const confirm = async () => {
    try { await change(target).unwrap(); dispatch(showToast(target === 'free' ? 'Cancellation scheduled' : 'Plan change scheduled')); onDone(); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  return (
    <Dialog open={!!target} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{target === 'free' ? 'Cancel your subscription?' : `Switch to ${name}?`}</DialogTitle>
      <DialogContent>
        {isFetching || !data ? <Skeleton variant="rounded" height={120} /> : (
          <Stack spacing={2}>
            <Typography>You keep your current plan until the end of the period you have paid for. Nothing is deleted.</Typography>
            {data.blockers.map((b) => <Alert key={b} severity="error">{b}</Alert>)}
            {data.warnings.length > 0 && (
              <Alert severity="warning">
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>After that:</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{data.warnings.map((w) => <li key={w}>{w}</li>)}</Box>
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>Keep my plan</Button>
        <Button variant="contained" color="error" disabled={!data || data.blockers.length > 0 || isLoading} onClick={confirm}>{target === 'free' ? 'Cancel at period end' : 'Schedule the change'}</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function BillingPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canManage = useSelector(selectCan('account:update'));
  const { data, isLoading, error, refetch } = useGetBillingQuery(undefined, { pollingInterval: params.get('checkout') === 'success' ? 2000 : 0 });
  const { data: planData } = useListPlansQuery();
  const [startCheckout, checkout] = useStartCheckoutMutation();
  const [resume, resuming] = useResumePlanMutation();
  const [downgrade, setDowngrade] = useState(null);

  const returned = params.get('checkout');
  const sub = data?.subscription;
  const current = data?.plan.id;
  const plans = planData?.plans ?? [];
  const provider = data?.provider;
  const canBuy = canManage && provider?.configured;

  const upgrade = async (plan) => {
    try {
      const { url } = await startCheckout(plan).unwrap();
      if (url.startsWith(window.location.origin)) navigate(url.slice(window.location.origin.length)); else window.location.assign(url);
    } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };

  return (
    <PageTransition>
      <PageHeader title="Billing & plan" description="Your plan, what you are using, and your invoices." />
      {error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : isLoading || !data ? <Skeleton variant="rounded" height={320} /> : (
        <Stack spacing={2.5}>
          {returned === 'success' && <Alert severity={sub?.status === 'active' && sub.plan === current ? 'success' : 'info'}>{sub?.status === 'active' ? `You are on the ${data.plan.name} plan.` : 'Waiting for the payment provider to confirm your payment. This usually takes a few seconds. Your plan changes only once it does.'}</Alert>}
          {returned === 'cancelled' && <Alert severity="info" onClose={() => setParams({})}>Checkout was cancelled. Nothing was charged and your plan has not changed.</Alert>}
          {provider?.name === 'test' && <Alert severity="info">Test mode: payments on this server are simulated. No card is used and no money moves.</Alert>}
          {!provider?.name && <Alert severity="warning">Billing is not set up on this server, so plans cannot be purchased here. Your current plan and usage are shown below.</Alert>}
          {provider?.name && !provider.configured && <Alert severity="warning">The payment provider is not fully configured. Ask whoever runs this server to finish the billing setup.</Alert>}
          {sub?.status === 'past_due' && <Alert severity="error">Your last payment failed. Update your payment method with your provider so your plan stays active.</Alert>}
          {(sub?.cancelAtPeriodEnd || sub?.pendingPlan) && (
            <Alert severity="warning" action={canManage && <Button color="inherit" size="small" disabled={resuming.isLoading} onClick={async () => { try { await resume().unwrap(); dispatch(showToast('Scheduled change undone')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } }}>Keep my plan</Button>}>
              {sub.cancelAtPeriodEnd ? 'Your subscription ends' : `Your plan changes to ${plans.find((p) => p.id === sub.pendingPlan)?.name ?? sub.pendingPlan}`} on {dayjs(sub.currentPeriodEnd).format('D MMMM YYYY')}.
            </Alert>
          )}

          <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '2fr 3fr' } }}>
            <Card sx={{ p: 3 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">{data.plan.name} plan</Typography>
                <Chip size="small" color={sub?.status === 'past_due' ? 'error' : 'primary'} label={sub ? (sub.status === 'past_due' ? 'Payment failed' : 'Active') : 'Included'} />
              </Stack>
              <Typography variant="h4" sx={{ mt: 1 }}>{money(data.plan.priceMonthly)}{data.plan.priceMonthly > 0 && <Typography component="span" color="text.secondary"> / month</Typography>}</Typography>
              {sub?.currentPeriodEnd && <Typography color="text.secondary" sx={{ mt: 0.5 }}>{sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {dayjs(sub.currentPeriodEnd).format('D MMMM YYYY')}</Typography>}
              <Typography color="text.secondary" sx={{ mt: 1 }}>{data.plan.blurb}</Typography>
            </Card>
            <Card sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Usage</Typography>
              <Stack spacing={2}>
                {data.usage.meters.map((m) => <Meter key={m.key} m={m} />)}
                <Typography variant="body2" color="text.secondary">File storage in use: {(data.usage.storageBytes / 1048576).toFixed(1)} MB · Largest file: {data.entitlements.maxUploadMb} MB</Typography>
              </Stack>
            </Card>
          </Box>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
            {plans.map((p) => {
              const here = p.id === current;
              const up = RANK[p.id] > RANK[current];
              return (
                <Card key={p.id} variant="outlined" sx={{ p: 3, borderColor: here ? 'primary.main' : 'divider', borderWidth: here ? 2 : 1 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="h6">{p.name}</Typography>{here && <Chip size="small" color="primary" label="Current" />}</Stack>
                  <Typography variant="h5" sx={{ my: 1 }}>{money(p.priceMonthly)}{p.priceMonthly > 0 && <Typography component="span" variant="body2" color="text.secondary"> / month</Typography>}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>{p.blurb}</Typography>
                  <Stack spacing={0.75} sx={{ my: 2 }}>
                    {Object.entries(planData.labels).map(([key, label]) => (
                      <Stack key={key} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2">{label}</Typography><Box sx={{ display: 'flex' }}>{fmt(p.limits[key])}</Box>
                      </Stack>
                    ))}
                  </Stack>
                  {here ? <Button fullWidth disabled>Your plan</Button>
                    : up ? <Button fullWidth variant="contained" disabled={!canBuy || checkout.isLoading} onClick={() => upgrade(p.id)}>Upgrade to {p.name}</Button>
                      : <Button fullWidth color="inherit" variant="outlined" disabled={!canManage || !sub || sub.status === 'canceled' || sub.cancelAtPeriodEnd} onClick={() => setDowngrade(p.id)}>{p.id === 'free' ? 'Cancel subscription' : `Switch to ${p.name}`}</Button>}
                </Card>
              );
            })}
          </Box>
          {!canManage && <Typography color="text.secondary">Only owners and admins can change the plan.</Typography>}

          <Card>
            <Typography variant="h6" sx={{ p: 3, pb: 1 }}>Invoices</Typography>
            {data.invoices.length === 0 ? <Typography color="text.secondary" sx={{ px: 3, pb: 3 }}>No invoices yet. They appear here after a payment.</Typography> : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Date</TableCell><TableCell>Number</TableCell><TableCell>Plan</TableCell><TableCell align="right">Amount</TableCell><TableCell>Status</TableCell><TableCell /></TableRow></TableHead>
                  <TableBody>
                    {data.invoices.map((i) => (
                      <TableRow key={i._id}>
                        <TableCell>{dayjs(i.createdAt).format('D MMM YYYY')}</TableCell><TableCell>{i.number ?? '—'}</TableCell><TableCell sx={{ textTransform: 'capitalize' }}>{i.plan}</TableCell>
                        <TableCell align="right">{money(i.amount, i.currency)}</TableCell>
                        <TableCell><Chip size="small" color={i.status === 'paid' ? 'success' : 'error'} label={i.status === 'paid' ? 'Paid' : 'Failed'} /></TableCell>
                        <TableCell align="right">{i.hostedUrl && <Button size="small" component="a" href={i.hostedUrl} target="_blank" rel="noopener noreferrer">View</Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Card>
        </Stack>
      )}
      <DowngradeDialog target={downgrade} plans={plans} onClose={() => setDowngrade(null)} onDone={() => setDowngrade(null)} />
    </PageTransition>
  );
}

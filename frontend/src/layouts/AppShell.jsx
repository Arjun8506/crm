import { Box, Container } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import useRealtime from '../hooks/useRealtime';
import usePageTracking from '../hooks/usePageTracking';
import NpsPrompt from '../features/business/NpsPrompt';
import { useGetOnboardingQuery } from '../features/business/businessApi';

export default function AppShell() {
  useRealtime();
  usePageTracking();
  const { pathname } = useLocation();
  const { data: onboarding, isFetching } = useGetOnboardingQuery();
  // A brand-new organisation's owner is taken to the setup wizard once; skipping it ends the redirect.
  if (onboarding?.setupNeeded && !isFetching && pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Sidebar />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar />
        <Container maxWidth="xl" component="main" sx={{ py: 4, flex: 1 }}>
          <Outlet />
        </Container>
        <NpsPrompt />
      </Box>
    </Box>
  );
}

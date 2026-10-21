import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, useSelector } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { MotionConfig } from 'framer-motion';
import { store } from './app/store';
import { createAppTheme } from './app/theme';
import AppRoutes from './app/router';
import { AuthBootstrap } from './features/auth/ProtectedRoute';
import { Toaster } from './components/common';

function ThemedApp() {
  const mode = useSelector((s) => s.ui.themeMode);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  const theme = useMemo(() => createAppTheme(resolved), [resolved]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <AuthBootstrap><AppRoutes /></AuthBootstrap>
        </BrowserRouter>
        <Toaster />
      </MotionConfig>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}><ThemedApp /></Provider>
  </StrictMode>,
);

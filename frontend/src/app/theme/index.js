import { createTheme, alpha } from '@mui/material/styles';

const brand = { main: '#4f46e5', light: '#818cf8', dark: '#3730a3' };

const palettes = {
  light: {
    primary: brand,
    background: { default: '#f6f7fb', paper: '#ffffff' },
    text: { primary: '#111827', secondary: '#5b6475' },
    divider: '#e5e7ee',
  },
  dark: {
    primary: { main: '#818cf8', light: '#a5b4fc', dark: '#4f46e5' },
    background: { default: '#0d0f16', paper: '#161924' },
    text: { primary: '#eef0f6', secondary: '#9aa3b5' },
    divider: '#262b3a',
  },
};

export const SIDEBAR_WIDTH = 260;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

export function createAppTheme(mode) {
  return createTheme({
    palette: { mode, ...palettes[mode] },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      h4: { fontWeight: 700, letterSpacing: '-0.02em' },
      h5: { fontWeight: 700, letterSpacing: '-0.015em' },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '@media (prefers-reduced-motion: reduce)': {
            '*': { transitionDuration: '0.01ms !important', animationDuration: '0.01ms !important' },
          },
        },
      },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 8 } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: {
          root: ({ theme }) => ({
            boxShadow: `0 1px 2px ${alpha('#101828', theme.palette.mode === 'dark' ? 0.4 : 0.04)}`,
          }),
        },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 8 } } },
    },
  });
}

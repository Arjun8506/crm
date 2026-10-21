import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Snackbar, Stack, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { hideToast } from '../../features/ui/uiSlice';

export function Logo({ size = 32, withText = true, collapsed = false }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25}>
      <Box
        sx={{
          width: size, height: size, borderRadius: 2, flexShrink: 0, display: 'grid', placeItems: 'center',
          color: 'primary.contrastText', background: (t) => `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.primary.dark})`,
        }}
      >
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12l5 5 9-10" />
        </svg>
      </Box>
      {withText && !collapsed && <Typography variant="h6" sx={{ letterSpacing: '-0.02em' }}>OrgCRM</Typography>}
    </Stack>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs }) {
  return (
    <Box sx={{ mb: 3 }}>
      {breadcrumbs && <Box sx={{ mb: 0.5 }}>{breadcrumbs}</Box>}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h1" noWrap>{title}</Typography>
          {description && <Typography color="text.secondary" sx={{ mt: 0.5 }}>{description}</Typography>}
        </Box>
        {actions && <Stack direction="row" spacing={1} flexShrink={0}>{actions}</Stack>}
      </Stack>
    </Box>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <Stack alignItems="center" textAlign="center" spacing={1.5} sx={{ py: 8, px: 2 }}>
      {icon && <Box sx={{ color: 'text.disabled', '& svg': { fontSize: 48 } }}>{icon}</Box>}
      <Typography variant="h6">{title}</Typography>
      {description && <Typography color="text.secondary" sx={{ maxWidth: 420 }}>{description}</Typography>}
      {action}
    </Stack>
  );
}

export function ErrorState({ message = 'Something went wrong', onRetry }) {
  return (
    <Alert severity="error" action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>Retry</Button>} sx={{ alignItems: 'center' }}>
      {message}
    </Alert>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', destructive, loading, onConfirm, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><DialogContentText>{message}</DialogContentText></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button onClick={onConfirm} variant="contained" color={destructive ? 'error' : 'primary'} disabled={loading}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function PageTransition({ children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}

export function Toaster() {
  const dispatch = useDispatch();
  const toast = useSelector((s) => s.ui.toast);
  return (
    <Snackbar
      key={toast?.id}
      open={!!toast}
      autoHideDuration={4000}
      onClose={(_e, reason) => reason !== 'clickaway' && dispatch(hideToast())}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {toast ? <Alert severity={toast.severity} variant="filled" onClose={() => dispatch(hideToast())}>{toast.message}</Alert> : undefined}
    </Snackbar>
  );
}

export function FullPageLoader() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} role="status" aria-label="Loading">
      <motion.div animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.4, repeat: Infinity }}>
        <Logo size={48} withText={false} />
      </motion.div>
    </Box>
  );
}

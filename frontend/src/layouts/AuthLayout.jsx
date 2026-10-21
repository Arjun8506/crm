import { Box, Card, Stack, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { Logo } from '../components/common';

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <Box
      sx={{
        minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2,
        background: (t) => (t.palette.mode === 'dark'
          ? 'radial-gradient(60% 50% at 50% 0%, rgba(99,102,241,0.18), transparent), #0d0f16'
          : 'radial-gradient(60% 50% at 50% 0%, rgba(99,102,241,0.14), transparent), #f6f7fb'),
      }}
    >
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} style={{ width: '100%', maxWidth: 420 }}>
        <Stack alignItems="center" sx={{ mb: 3 }}><Logo size={40} /></Stack>
        <Card sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" component="h1">{title}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>{subtitle}</Typography>
          {children}
        </Card>
        {footer && <Typography align="center" color="text.secondary" sx={{ mt: 2 }}>{footer}</Typography>}
      </motion.div>
    </Box>
  );
}

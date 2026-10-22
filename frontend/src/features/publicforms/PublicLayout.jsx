import { useEffect } from 'react';
import { Box, Card, Container, Typography } from '@mui/material';
import { Logo } from '../../components/common';

// Shell for pages opened by people without an account. Tells search engines to stay away.
export default function PublicLayout({ children, title }) {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const previous = document.title;
    if (title) document.title = title;
    return () => { meta.remove(); document.title = previous; };
  }, [title]);
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 6 } }}>
      <Container maxWidth="sm">
        <Card component="main" sx={{ p: { xs: 2.5, sm: 4 } }}>{children}</Card>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, mt: 3, opacity: 0.7 }}>
          <Typography variant="caption" color="text.secondary">Powered by</Typography>
          <Logo size={20} />
        </Box>
      </Container>
    </Box>
  );
}

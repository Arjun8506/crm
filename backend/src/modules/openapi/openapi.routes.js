import { Router } from 'express';
import { env } from '../../config/env.js';
import { buildSpec } from './spec.js';

// The description of the API is not secret: it is served without authentication, and contains no account data.
const router = Router();
router.get('/openapi.json', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(buildSpec({ serverUrl: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1` }));
});
export default router;

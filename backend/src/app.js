import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './modules/auth/auth.routes.js';
import accountRoutes from './modules/accounts/account.routes.js';
import userRoutes from './modules/users/user.routes.js';
import workspaceRoutes from './modules/workspaces/workspace.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api/v1', rateLimit({
    windowMs: 60 * 1000,
    limit: env.NODE_ENV === 'test' ? 10000 : 300,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/accounts', accountRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/workspaces', workspaceRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

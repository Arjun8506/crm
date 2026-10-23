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
import dataformRoutes from './modules/dataforms/dataform.routes.js';
import recordRoutes from './modules/records/record.routes.js';
import viewRoutes from './modules/views/view.routes.js';
import reportRoutes, { analyzeRouter } from './modules/analytics/analytics.routes.js';
import dashboardRoutes from './modules/analytics/dashboard.routes.js';
import commentRoutes, { recordCommentRouter } from './modules/comments/comment.routes.js';
import taskRoutes from './modules/tasks/task.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import attachmentRoutes, { recordAttachmentRouter } from './modules/attachments/attachment.routes.js';
import integrationRoutes from './modules/integrations/integration.routes.js';
import communicationRoutes, { recordInteractionRouter } from './modules/interactions/interaction.routes.js';
import webhookRoutes from './modules/interactions/webhook.routes.js';
import workflowRoutes from './modules/workflows/workflow.routes.js';
import apiKeyRoutes from './modules/apikeys/apikey.routes.js';
import outboundRoutes from './modules/outbound/webhook.routes.js';
import auditRoutes from './modules/audit/audit.js';
import { announcementRouter, feedbackRouter, npsRouter } from './modules/business/feedback.routes.js';
import insightsRoutes from './modules/business/insights.routes.js';
import onboardingRoutes from './modules/business/onboarding.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import billingRoutes, { billingWebhookRouter } from './modules/billing/billing.routes.js';
import openapiRoutes from './modules/openapi/openapi.routes.js';
import publicRoutes from './modules/publicforms/public.routes.js';
import { formAdminRouter, shareAdminRouter } from './modules/publicforms/form.routes.js';
import exportRoutes from './modules/imports/export.routes.js';
import importRoutes, { dataformImportRouter } from './modules/imports/import.routes.js';
import workspaceRoutes from './modules/workspaces/workspace.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(','), credentials: true }));
  // Payment provider webhooks need the exact raw bytes to verify their signature, so they are mounted before the JSON parser.
  app.use('/api/v1/webhooks/billing', express.raw({ type: '*/*', limit: '1mb' }), billingWebhookRouter);
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
  app.use('/api/v1/dataforms/:id/records/:recordId/shares', shareAdminRouter);
  app.use('/api/v1/dataforms/:id/records/:recordId', recordCommentRouter);
  app.use('/api/v1/dataforms/:id/records/:recordId', recordAttachmentRouter);
  app.use('/api/v1/dataforms/:id/records/:recordId', recordInteractionRouter);
  app.use('/api/v1/dataforms/:id/records', recordRoutes);
  app.use('/api/v1/dataforms/:id/imports', dataformImportRouter);
  app.use('/api/v1/dataforms/:id/forms', formAdminRouter);
  app.use('/api/v1/dataforms/:id/views', viewRoutes);
  app.use('/api/v1/dataforms/:id/analyze', analyzeRouter);
  app.use('/api/v1/dataforms', dataformRoutes);
  app.use('/api/v1/reports', reportRoutes);
  app.use('/api/v1/dashboards', dashboardRoutes);
  app.use('/api/v1/comments', commentRoutes);
  app.use('/api/v1/tasks', taskRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/attachments', attachmentRoutes);
  app.use('/api/v1/integrations', integrationRoutes);
  app.use('/api/v1/communications', communicationRoutes);
  app.use('/api/v1/workflows', workflowRoutes);
  app.use('/api/v1/webhooks', webhookRoutes);
  app.use('/api/v1/api-keys', apiKeyRoutes);
  app.use('/api/v1/outbound-webhooks', outboundRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/billing', billingRoutes);
  app.use('/api/v1/ai', aiRoutes);
  app.use('/api/v1/onboarding', onboardingRoutes);
  app.use('/api/v1/feedback', feedbackRouter);
  app.use('/api/v1/announcements', announcementRouter);
  app.use('/api/v1/nps', npsRouter);
  app.use('/api/v1/events', insightsRoutes);
  app.use('/api/v1', openapiRoutes);
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/v1/imports', importRoutes);
  app.use('/api/v1/exports', exportRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

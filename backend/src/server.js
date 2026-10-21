import http from 'node:http';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';
import { startWorker } from './modules/queue/queue.js';
import { attachSockets } from './sockets/index.js';

async function main() {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`[api] MongoDB connected (${mongoose.connection.name})`);
  await mongoose.syncIndexes();

  const server = http.createServer(createApp());
  attachSockets(server);
  const stopScheduler = startScheduler();
  const stopWorker = startWorker();
  server.listen(env.PORT, () => console.log(`[api] listening on http://localhost:${env.PORT} (REST + Socket.IO)`));

  const shutdown = async () => {
    stopScheduler();
    stopWorker();
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (err) => {
  console.error('[api] unhandled rejection', err);
});

main().catch((err) => {
  console.error('[api] failed to start:', err.message);
  process.exit(1);
});

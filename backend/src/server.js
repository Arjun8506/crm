import mongoose from 'mongoose';
import { env } from './config/env.js';
import { createApp } from './app.js';

async function main() {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`[api] MongoDB connected (${mongoose.connection.name})`);
  await mongoose.syncIndexes();

  const server = createApp().listen(env.PORT, () => console.log(`[api] listening on http://localhost:${env.PORT}`));

  const shutdown = async () => {
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

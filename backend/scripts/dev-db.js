// Starts a persistent local MongoDB (via mongodb-memory-server's mongod binary) for development.
// Data lives in .data/mongo. Use MONGO_URI in server/.env to point at a real MongoDB instead.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dbPath = resolve(import.meta.dirname, '..', '.data', 'mongo');
mkdirSync(dbPath, { recursive: true });
const port = Number(process.env.DEV_DB_PORT || 27018);

// Pin the binary: an existing data dir cannot be opened by a different mongod major/minor version.
const mongod = await MongoMemoryServer.create({
  binary: { version: '8.2.6' },
  instance: { port, dbPath, storageEngine: 'wiredTiger' },
});
console.log(`[dev-db] MongoDB ready at ${mongod.getUri()} (data: ${dbPath})`);

const stop = async () => {
  await mongod.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

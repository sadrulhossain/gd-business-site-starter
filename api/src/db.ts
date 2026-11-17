import mongoose from 'mongoose';
import type { Env } from './env.js';

/**
 * Workers cannot share I/O objects across requests, so each request that needs the
 * database opens its own small connection and closes it when the response ends.
 */
export function openConnection(env: Env): mongoose.Connection {
  return mongoose.createConnection(env.MONGODB_URI, {
    dbName: env.MONGODB_DB,
    maxPoolSize: 2,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 3000,
    autoIndex: false,
  });
}

export async function ping(conn: mongoose.Connection): Promise<void> {
  await conn.asPromise();
  await conn.db!.admin().ping();
}

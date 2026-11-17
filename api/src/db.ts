import mongoose from 'mongoose';
import type { Env } from './env.ts';

// Operators inside filter values are neutralised; our own $in/$lt filters opt in with mongoose.trusted().
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

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

/** Filter helpers that survive sanitizeFilter. Only pass values that were validated. */
export const inList = <T>(values: T[]) => mongoose.trusted({ $in: values });
export const before = (d: Date) => mongoose.trusted({ $lt: d });
export const after = (d: Date) => mongoose.trusted({ $gt: d });
export const between = (gt: Date, lte: Date) => mongoose.trusted({ $gt: gt, $lte: lte });
export const upTo = (d: Date) => mongoose.trusted({ $lte: d });
export const notEq = <T>(value: T) => mongoose.trusted({ $ne: value });

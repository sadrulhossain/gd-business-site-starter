import express, { type Express } from 'express';
import type mongoose from 'mongoose';
import { openConnection } from './db.js';
import type { Env } from './env.js';
import { errorHandler, notFound } from './errors.js';
import { cors, requestId, securityHeaders } from './middleware/base.js';
import { v1 } from './routes/v1.js';

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
      /** Lazily opened per-request connection; closed after the response. */
      db: () => mongoose.Connection;
    }
  }
}

export function createApp(env: Env): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(requestId);
  app.use(securityHeaders);
  app.use(cors(env));
  app.use((_req, res, next) => {
    let conn: mongoose.Connection | undefined;
    res.locals.db = () => (conn ??= openConnection(env));
    res.on('close', () => {
      if (conn) void conn.close().catch(() => undefined);
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', v1(env));
  app.use(notFound);
  app.use(errorHandler(env));
  return app;
}

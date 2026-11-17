import express, { type Express } from 'express';
import type mongoose from 'mongoose';
import { openConnection } from './db.ts';
import type { Env } from './env.ts';
import { errorHandler, notFound } from './errors.ts';
import type { RouteMeta } from './http/route.ts';
import type { Auth } from './middleware/auth.ts';
import { cors, requestId, securityHeaders } from './middleware/base.ts';
import { getModels, type Models } from './models.ts';
import { v1 } from './routes/v1.ts';

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
      /** Lazily opened per-request connection; closed after the response. */
      db: () => mongoose.Connection;
      models: () => Models;
      /** Set by authenticate() on non-public routes. */
      auth?: Auth;
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
    res.locals.models = () => getModels(res.locals.db());
    res.on('close', () => {
      if (conn) void conn.close().catch(() => undefined);
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  const { router, api } = v1(env);
  app.locals.routes = api.routes satisfies RouteMeta[];
  app.use('/api/v1', router);
  app.use(notFound);
  app.use(errorHandler(env));
  return app;
}

import { Router, type RequestHandler } from 'express';
import { ping } from '../db.js';
import { locales, type Env } from '../env.js';
import { HttpError } from '../errors.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Registers handlers per method and answers other methods on the same path with a JSON 405. */
function route(router: Router, path: string, handlers: Partial<Record<Method, RequestHandler>>): void {
  const methods = Object.keys(handlers) as Method[];
  for (const m of methods) router[m](path, handlers[m]!);
  router.all(path, (_req, _res, next) =>
    next(new HttpError(405, 'method_not_allowed', 'Method not allowed.', undefined, { Allow: methods.map((m) => m.toUpperCase()).join(', ') })),
  );
}

export function v1(env: Env): Router {
  const r = Router();

  route(r, '/health', {
    get: async (_req, res) => {
      let database: 'ok' | 'fail' = 'ok';
      try {
        await ping(res.locals.db());
      } catch {
        database = 'fail';
      }
      res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', database });
    },
  });

  route(r, '/meta/locales', {
    get: (_req, res) => {
      const { default: def, fallback, supported } = locales(env);
      res.json({ data: { default: def, fallback, supported } });
    },
  });

  return r;
}

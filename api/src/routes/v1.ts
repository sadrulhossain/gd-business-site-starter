import type { Router } from 'express';
import { ping } from '../db.ts';
import { locales, type Env } from '../env.ts';
import { Api } from '../http/route.ts';
import { authRoutes } from '../modules/auth/routes.ts';
import { meRoutes } from '../modules/me/routes.ts';
import { menuRoutes } from '../modules/menus/routes.ts';
import { sectionRoutes } from '../modules/sections/routes.ts';
import { settingRoutes } from '../modules/settings/routes.ts';
import { roleRoutes } from '../modules/roles/routes.ts';
import { userRoutes } from '../modules/users/routes.ts';

/** Builds the /api/v1 router. `api.routes` is the declared-route registry the audit test reads. */
export function v1(env: Env): { router: Router; api: Api } {
  const api = new Api(env);

  api.get('/health', { public: true }, async (_req, res) => {
    let database: 'ok' | 'fail' = 'ok';
    try {
      await ping(res.locals.db());
    } catch {
      database = 'fail';
    }
    res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', database });
  });

  api.get('/meta/locales', { public: true }, (_req, res) => {
    const { default: def, fallback, supported } = locales(env);
    res.json({ data: { default: def, fallback, supported } });
  });

  authRoutes(api, env);
  meRoutes(api);
  userRoutes(api);
  roleRoutes(api);
  menuRoutes(api);
  settingRoutes(api, env);
  sectionRoutes(api, env);

  return { router: api.finish(), api };
}

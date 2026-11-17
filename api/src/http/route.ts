import { Router, type RequestHandler } from 'express';
import type { Env } from '../env.ts';
import { HttpError } from '../errors.ts';
import { authenticate, can } from '../middleware/auth.ts';

/** Every route declares its access: public, a permission, or own (any signed-in user, acting on themselves). */
export type Access = { public: true } | { permission: string } | { own: true };
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteMeta {
  method: Method;
  path: string;
  access: Access;
}

/**
 * The only way to add a route. It records the metadata (used by the route audit test) and applies
 * authenticate and can() from it, then answers other methods on a known path with a JSON 405.
 */
export class Api {
  readonly router = Router();
  readonly routes: RouteMeta[] = [];
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  private add(method: Method, path: string, access: Access, handlers: RequestHandler[]): void {
    const chain: RequestHandler[] = [];
    if (!('public' in access)) chain.push(authenticate(this.env));
    if ('permission' in access) chain.push(can(access.permission));
    this.router[method](path, ...chain, ...handlers);
    this.routes.push({ method, path, access });
  }

  get(path: string, access: Access, ...h: RequestHandler[]): void { this.add('get', path, access, h); }
  post(path: string, access: Access, ...h: RequestHandler[]): void { this.add('post', path, access, h); }
  put(path: string, access: Access, ...h: RequestHandler[]): void { this.add('put', path, access, h); }
  patch(path: string, access: Access, ...h: RequestHandler[]): void { this.add('patch', path, access, h); }
  delete(path: string, access: Access, ...h: RequestHandler[]): void { this.add('delete', path, access, h); }

  /** Call once after all routes are declared. */
  finish(): Router {
    const byPath = new Map<string, Set<string>>();
    for (const r of this.routes) (byPath.get(r.path) ?? byPath.set(r.path, new Set()).get(r.path)!).add(r.method.toUpperCase());
    for (const [path, methods] of byPath) {
      this.router.all(path, (_req, _res, next) =>
        next(new HttpError(405, 'method_not_allowed', 'Method not allowed.', undefined, { Allow: [...methods].join(', ') })),
      );
    }
    return this.router;
  }
}

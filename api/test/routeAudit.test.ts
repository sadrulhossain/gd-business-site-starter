import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { RouteMeta } from '../src/http/route.ts';
import { permissionNames } from '../src/access/modules.ts';
import { testEnv } from './helpers.ts';

// Port of the legacy AuditRoutes command: every route must declare how it is protected.
const app = createApp(testEnv());
const routes = app.locals.routes as RouteMeta[];

/** Route layers actually mounted on the v1 router (anything added around the Api helper shows up here). */
function mountedRoutes(): number {
  const stack = (app.router as unknown as { stack: { name: string; handle: { stack?: { route?: { methods: Record<string, boolean>; stack: unknown[] } }[] } }[] }).stack;
  const v1 = stack.find((l) => l.name === 'router' && l.handle.stack?.some((s) => s.route));
  return (v1?.handle.stack ?? []).filter((l) => l.route && !l.route.methods._all).length;
}

describe('route audit', () => {
  it('declares public, a permission, or own for every route', () => {
    expect(routes.length).toBeGreaterThan(10);
    const bad = routes.filter((r) => {
      const a = r.access as Record<string, unknown>;
      return !('public' in a || typeof a.permission === 'string' || 'own' in a);
    });
    expect(bad).toEqual([]);
  });

  it('has no route outside the helper', () => {
    expect(mountedRoutes()).toBe(routes.length);
  });

  it('only uses permissions that exist in the registry', () => {
    const known = new Set(permissionNames());
    const unknown = routes.map((r) => r.access).filter((a): a is { permission: string } => 'permission' in a && !known.has(a.permission));
    expect(unknown).toEqual([]);
  });

  it('keeps the public surface to the expected endpoints', () => {
    const open = routes.filter((r) => 'public' in r.access).map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(open).toEqual(['GET /health', 'GET /meta/locales', 'GET /public/sections', 'GET /public/settings', 'POST /auth/login', 'POST /auth/refresh', 'POST /logout']);
  });

  it('answers 401 on every non-public route without a token', async () => {
    const { default: supertest } = await import('supertest');
    for (const r of routes.filter((x) => !('public' in x.access))) {
      const res = await supertest(app)[r.method](`/api/v1${r.path.replace(':id', '1')}`);
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });
});

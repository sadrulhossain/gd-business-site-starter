import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Env } from '../env.ts';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[\w.-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.set('X-Request-Id', id);
  next();
};

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  });
  next();
};

/** Credentials only for exact origins from CORS_ALLOWED_ORIGINS; never a wildcard. */
export const cors = (env: Env): RequestHandler => {
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin) res.vary('Origin');
    if (origin && allowed.has(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
      });
      if (req.method === 'OPTIONS') {
        res.set({
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': req.get('access-control-request-headers') ?? 'Content-Type, Authorization',
          'Access-Control-Max-Age': '600',
        });
        res.status(204).end();
        return;
      }
    }
    next();
  };
};

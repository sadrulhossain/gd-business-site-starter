import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { HttpError } from '../errors.ts';

/** Client address: Cloudflare header first, then Express's proxy-aware value. */
export const clientIp = (req: Request): string => req.get('cf-connecting-ip') ?? req.ip ?? 'unknown';

export const hashKey = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * Fixed-window counter in the rate_limits collection (ADR 015): $inc upsert, TTL index on expires_at.
 * Throws 429 when `limit` is exceeded inside the window.
 */
export async function hit(req: Request, res: { locals: Express.Locals }, bucket: string, subject: string, limit: number, windowSeconds: number): Promise<void> {
  const { RateLimit } = res.locals.models();
  const now = Date.now();
  const window = Math.floor(now / (windowSeconds * 1000));
  const expires = new Date((window + 1) * windowSeconds * 1000 + 60_000);
  const doc = await RateLimit.findOneAndUpdate(
    { _id: `${bucket}:${hashKey(subject)}:${window}` },
    { $inc: { count: 1 }, $setOnInsert: { expires_at: expires } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  if (doc!.count > limit) {
    const retry = Math.max(1, Math.ceil(((window + 1) * windowSeconds * 1000 - now) / 1000));
    throw new HttpError(429, 'too_many_requests', 'Too many attempts. Try again later.', undefined, { 'Retry-After': String(retry) });
  }
  void req;
}

/** Middleware form: limit per client IP. */
export const limitByIp = (bucket: string, limit: number, windowSeconds: number): RequestHandler => async (req, res, next) => {
  try {
    await hit(req, res, bucket, clientIp(req), limit, windowSeconds);
    next();
  } catch (e) {
    next(e);
  }
};

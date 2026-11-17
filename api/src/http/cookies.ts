import type { Request, Response } from 'express';
import { cookieName, refreshTtlDays, type Env } from '../env.ts';

/** Reads one cookie from the Cookie header (no cookie-parser dependency). */
export function readCookie(req: Request, name: string): string | null {
  const header = req.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Host-only (no Domain), Path=/, HttpOnly, Secure, SameSite=Lax. The token never appears in a body or a log.
export function setRefreshCookie(env: Env, res: Response, token: string): void {
  const maxAge = refreshTtlDays(env) * 86400;
  res.append('Set-Cookie', `${cookieName(env)}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

export function clearRefreshCookie(env: Env, res: Response): void {
  res.append('Set-Cookie', `${cookieName(env)}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

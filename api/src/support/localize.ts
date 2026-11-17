import type { RequestHandler } from 'express';
import { locales, type Env } from '../env.ts';
import { validationError } from '../http/validate.ts';

const filled = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

/**
 * Port of LocalizePublicResponse::collapse. Removes every x_2nd key; when `useSecond` and the twin is filled it
 * replaces x with it, so an empty second language falls back to the first.
 */
export function collapse(value: unknown, useSecond: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => collapse(v, useSecond));
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(src)) {
    if (key.endsWith('_2nd')) continue;
    out[key] = collapse(item, useSecond);
  }
  if (useSecond) {
    for (const [key, item] of Object.entries(src)) {
      if (key.endsWith('_2nd') && filled(item)) {
        const base = key.slice(0, -4);
        if (base in out) out[base] = collapse(item, useSecond);
      }
    }
  }
  return out;
}

/**
 * Public reads: without ?lang both languages are returned. With ?lang=<supported> the response carries one language
 * under the base keys. An unsupported value is a 422 (as in the legacy middleware).
 */
export const localizePublic = (env: Env): RequestHandler => (req, res, next) => {
  const lang = req.query.lang;
  if (lang === undefined) return next();
  const l = locales(env);
  if (typeof lang !== 'string' || !l.supported.includes(lang)) return next(validationError({ lang: ['Unsupported language.'] }));
  const useSecond = l.second !== null && lang === l.second;
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(collapse(JSON.parse(JSON.stringify(body)), useSecond));
  next();
};

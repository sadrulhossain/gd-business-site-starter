import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isDebug, type Env } from './env.ts';

/** Throw from any handler; rendered as {error:{code,message,details?}}. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const unauthenticated = () => new HttpError(401, 'unauthenticated', 'Unauthenticated.');
export const forbidden = (message = 'This action is unauthorized.') => new HttpError(403, 'forbidden', message);
export const notFoundError = () => new HttpError(404, 'not_found', 'Not found.');

const CODES: Record<number, string> = {
  400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed',
  409: 'conflict', 413: 'payload_too_large', 415: 'unsupported_media_type', 422: 'unprocessable', 429: 'too_many_requests',
};
export const codeFor = (status: number): string => CODES[status] ?? (status >= 500 ? 'server_error' : 'http_error');

export const notFound: RequestHandler = (_req, _res, next) => next(notFoundError());

export const errorHandler = (env: Env): ErrorRequestHandler => (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  let status = 500;
  let code = 'server_error';
  let message = isDebug(env) && err instanceof Error ? err.message : 'Server error.';
  let details: Record<string, unknown> | undefined;
  let headers: Record<string, string> = {};

  if (err instanceof HttpError) {
    ({ status, code, message, details, headers } = err);
  } else if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    // body-parser errors (malformed JSON, too large)
    status = err.status;
    code = codeFor(status);
    message = status === 413 ? 'Payload too large.' : status === 400 ? 'Malformed request body.' : 'Request error.';
  } else if (process.env.VITEST === undefined) {
    console.error('unhandled', err instanceof Error ? err.stack : err);
  }
  res.status(status).set(headers).json({ error: { code, message, ...(details ? { details } : {}) } });
};

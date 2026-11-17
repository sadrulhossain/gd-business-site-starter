import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isDebug, type Env } from './env.js';

/** Throw from any handler; rendered as {error:{code,message,details?}}. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const CODES: Record<number, string> = {
  400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed',
  409: 'conflict', 413: 'payload_too_large', 415: 'unsupported_media_type', 422: 'unprocessable', 429: 'too_many_requests',
};
export const codeFor = (status: number): string => CODES[status] ?? (status >= 500 ? 'server_error' : 'http_error');

export const notFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, 'not_found', 'Not found.'));

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
  } else {
    console.error('unhandled', err instanceof Error ? err.stack : err);
  }
  res.status(status).set(headers).json({ error: { code, message, ...(details ? { details } : {}) } });
};

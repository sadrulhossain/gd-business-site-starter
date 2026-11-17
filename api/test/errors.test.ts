import express from 'express';
import supertest from 'supertest';
import { expect, it } from 'vitest';
import { errorHandler, HttpError } from '../src/errors.ts';
import { client, testEnv } from './helpers.ts';

it('renders unknown routes as a json 404 error', async () => {
  const res = await client().get('/api/v1/nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
});

it('renders wrong methods as a json 405 error with Allow', async () => {
  const res = await client().post('/api/v1/health');
  expect(res.status).toBe(405);
  expect(res.body.error.code).toBe('method_not_allowed');
  expect(res.headers.allow).toBe('GET');
});

it('renders malformed json as 400', async () => {
  const res = await client().post('/api/v1/health').set('Content-Type', 'application/json').send('{bad');
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('bad_request');
});

function failing(debug: boolean, err: unknown) {
  const env = testEnv({ APP_DEBUG: debug ? 'true' : 'false' });
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler(env));
  return supertest(app).get('/boom');
}

it('renders details of an HttpError', async () => {
  const res = await failing(false, new HttpError(422, 'validation_failed', 'Required.', { name: ['Required.'] }));
  expect(res.status).toBe(422);
  expect(res.body).toEqual({ error: { code: 'validation_failed', message: 'Required.', details: { name: ['Required.'] } } });
});

it('hides server error messages when debug is off', async () => {
  const res = await failing(false, new Error('secret'));
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: { code: 'server_error', message: 'Server error.' } });
});

it('shows server error messages when debug is on', async () => {
  const res = await failing(true, new Error('secret'));
  expect(res.body.error.message).toBe('secret');
});

it('sends baseline headers and a request id', async () => {
  const res = await client().get('/api/v1/meta/locales');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
});

it('allows credentials only for exact configured origins', async () => {
  const c = client({ CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test' });
  const ok = await c.get('/api/v1/meta/locales').set('Origin', 'http://b.test');
  expect(ok.headers['access-control-allow-origin']).toBe('http://b.test');
  expect(ok.headers['access-control-allow-credentials']).toBe('true');
  const no = await c.get('/api/v1/meta/locales').set('Origin', 'http://evil.test');
  expect(no.headers['access-control-allow-origin']).toBeUndefined();
  const pre = await c.options('/api/v1/health').set('Origin', 'http://a.test').set('Access-Control-Request-Method', 'POST');
  expect(pre.status).toBe(204);
});

import mongoose from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { client, testEnv } from './helpers.js';

// The testing database is dropped per file; never the dev database.
beforeAll(async () => {
  const c = mongoose.createConnection(testEnv().MONGODB_URI, { dbName: testEnv().MONGODB_DB });
  await c.asPromise();
  await c.dropDatabase();
  await c.close();
});
afterAll(() => mongoose.disconnect());

it('reports ok when the database answers', async () => {
  const res = await client().get('/api/v1/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok', database: 'ok' });
});

it('reports degraded (503) when the database is unreachable', async () => {
  const res = await client({ MONGODB_URI: 'mongodb://127.0.0.1:1' }).get('/api/v1/health');
  expect(res.status).toBe(503);
  expect(res.body).toEqual({ status: 'degraded', database: 'fail' });
});

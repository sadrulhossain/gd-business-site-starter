import { expect, it } from 'vitest';
import { locales } from '../src/env.ts';
import { client } from './helpers.ts';

it('lists locales from env', async () => {
  const res = await client({ LOCALE_DEFAULT: 'en', LOCALE_FALLBACK: 'en', LOCALE_SUPPORTED: 'en,bn' }).get('/api/v1/meta/locales');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ data: { default: 'en', fallback: 'en', supported: ['en', 'bn'] } });
});

it('parses LOCALE_SUPPORTED as a trimmed comma list', () => {
  const l = locales({ MONGODB_URI: '', MONGODB_DB: '', LOCALE_SUPPORTED: ' en, bn ,' });
  expect(l.supported).toEqual(['en', 'bn']);
  expect(l.second).toBe('bn');
});

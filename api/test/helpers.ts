import supertest from 'supertest';
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';

export const testEnv = (over: Partial<Env> = {}): Env => ({
  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://mongo:27017',
  MONGODB_DB: `${process.env.MONGODB_DB ?? 'gdsite'}_testing`,
  APP_DEBUG: 'false',
  LOCALE_DEFAULT: 'en',
  LOCALE_FALLBACK: 'en',
  LOCALE_SUPPORTED: 'en',
  ...over,
});

export const client = (over: Partial<Env> = {}) => supertest(createApp(testEnv(over)));

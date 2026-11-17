// pnpm --filter @gd/api openapi   (writes packages/api-types/openapi.json; see `make openapi`)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import type { RouteMeta } from '../http/route.ts';
import { buildSpec } from './spec.ts';

const app = createApp({ MONGODB_URI: 'mongodb://unused', MONGODB_DB: 'unused' });
const spec = buildSpec(app.locals.routes as RouteMeta[]);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/api-types/openapi.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`openapi: wrote ${out}`);

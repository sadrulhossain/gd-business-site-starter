import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { RouteMeta } from '../src/http/route.ts';
import { buildSpec } from '../src/openapi/spec.ts';
import * as R from '../src/openapi/responses.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { seedAccess } from '../src/seed/seed.ts';
import { actingAsSuperadmin, client, testEnv, useDb } from './helpers.ts';

const db = useDb();
const repo = resolve(import.meta.dirname, '../..');

beforeAll(async () => {
  await db.reset();
  await seedAccess(db.m, {});
  await seedDemo(db.m);
});
afterAll(() => db.close());

const routes = () => createApp(testEnv()).locals.routes as RouteMeta[];

describe('generated contract', () => {
  it('documents every registered route and nothing else', () => {
    const spec = buildSpec(routes()) as { paths: Record<string, Record<string, unknown>> };
    const documented = Object.entries(spec.paths).flatMap(([p, item]) => Object.keys(item).filter((m) => m !== 'parameters').map((m) => `${m} ${p}`)).sort();
    const registered = routes().map((r) => `${r.method} /v1${r.path.replace(/:(\w+)/g, '{$1}')}`).sort();
    expect(documented).toEqual(registered);
  });

  it('marks secured routes with bearer auth and their permission', () => {
    const spec = buildSpec(routes()) as { paths: Record<string, Record<string, { security?: unknown[]; 'x-permission'?: string }>> };
    expect(spec.paths['/v1/faqs']!.get!.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths['/v1/faqs']!.get!['x-permission']).toBe('faqs.view');
    expect(spec.paths['/v1/public/faqs']!.get!.security).toEqual([]);
  });

  it('packages/api-types/openapi.json is up to date (run `make openapi`)', () => {
    const committed = readFileSync(resolve(repo, 'packages/api-types/openapi.json'), 'utf8');
    expect(committed).toBe(`${JSON.stringify(buildSpec(routes()), null, 2)}\n`);
  });

  it('matches the legacy contract except for the differences listed in docs/CONTRACT-DIFFS.md', () => {
    const out = execFileSync('node', [resolve(repo, 'scripts/openapi-parity.mjs')], { encoding: 'utf8' });
    expect(out).toContain('parity: ok');
  });
});

/** The zod response schemas must describe what the handlers really send. */
describe('response schemas match real responses', () => {
  const get = async (path: string) => {
    const admin = await actingAsSuperadmin(db.m);
    return (await client().get(`/api/v1${path}`).set(admin.auth).expect(200)).body;
  };
  const first = (body: { data: unknown[] }) => body.data[0];

  it('content modules (admin and public)', async () => {
    const image = { path: 'services/abc/960.webp', width: 960, height: 640, variants: [{ width: 480, path: 'services/abc/480.webp' }, { width: 960, path: 'services/abc/960.webp' }], committed_at: new Date() };
    await db.m.Service.updateOne({}, { $set: { image } });
    await db.m.Setting.updateOne({ _id: 1 }, { $set: { logo: image } });
    const cases: [string, { parse(v: unknown): unknown }][] = [
      ['/faqs', R.FaqResource], ['/public/faqs', R.FaqResource], ['/services', R.ServiceResource], ['/public/services', R.ServiceResource],
      ['/pricing', R.PricingResource], ['/public/pricing', R.PricingResource], ['/testimonials', R.TestimonialResource], ['/team', R.TeamMemberResource],
      ['/sections', R.SectionResource], ['/public/sections', R.SectionResource], ['/roles', R.RoleResource], ['/menus', R.MenuResource],
    ];
    for (const [path, schema] of cases) schema.parse(first(await get(path)));
    R.ServiceResource.parse(first(await get('/services')));
    expect(first(await get('/services'))).toMatchObject({ image: { width: 960 } });
    for (const path of ['/settings', '/public/settings']) R.SettingResource.parse((await get(path)).data);
    for (const path of ['/hero', '/about']) R.SectionResource.parse((await get(path)).data);
    R.GalleryItemResource.parse({ id: 1, title: null, title_2nd: null, caption: null, caption_2nd: null, image: null, sort_order: 0, is_visible: true, updated_at: null });
  });

  it('blog, contact, users and the signed-in user', async () => {
    await db.m.Category.create({ _id: 1, name: 'News', slug: 'news' });
    await db.m.Post.create({ _id: 1, title: 'T', slug: 't', category_id: 1, is_published: true, published_at: new Date() });
    await db.m.ContactMessage.create({ _id: 1, name: 'J', email: 'j@example.test', message: 'm' });
    R.PostResource.parse(first(await get('/posts')));
    R.PostResource.parse(first(await get('/public/posts')));
    R.PostResource.parse((await get('/public/posts/t')).data);
    R.CategoryResource.parse(first(await get('/categories')));
    R.ContactMessageResource.parse(first(await get('/contact-messages')));
    R.UserResource.parse(first(await get('/users')));
    R.MeResource.parse((await get('/me')).data);
    for (const n of (await get('/me/menus')).data) R.MenuNode.parse(n);
    R.Counts.parse((await get('/dashboard')).data);
    R.SiteStatus.parse((await get('/site/status')).data);
    R.Captcha.parse((await client().get('/api/v1/public/captcha').expect(200)).body.data);
    R.Locales.parse((await client().get('/api/v1/meta/locales').expect(200)).body.data);
  });
});

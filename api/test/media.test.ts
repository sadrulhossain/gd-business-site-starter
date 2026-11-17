import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.ts';
import { drainDeferred } from '../src/runtime.ts';
import { seedAccess } from '../src/seed/seed.ts';
import { actingAs, client, useDb } from './helpers.ts';
import { fakeGithub, ico, jpeg, png, webp } from './media-helpers.ts';

const db = useDb();
const env: Partial<Env> = { GITHUB_REPO: 'o/r', GITHUB_REPO_TOKEN: 'tok', MEDIA_BASE_PATH: '/media' };
let gh: ReturnType<typeof fakeGithub>;
let auth: { Authorization: string };

beforeAll(() => db.reset());
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  await seedAccess(db.m, {});
  gh = fakeGithub();
  vi.stubGlobal('fetch', gh.fetch);
  auth = (await actingAs(db.m, 'editor', ['sections.view', 'sections.update', 'settings.view', 'settings.update'])).auth;
});
afterEach(async () => {
  await drainDeferred();
  vi.unstubAllGlobals();
});

const heroId = async () => (await db.m.Section.findOne({ key: 'hero' }).lean())!._id;

function upload(path: string, parts: { variants?: Buffer[]; width?: number; height?: number; field?: Buffer; fieldName?: string; fileName?: string }, e = env) {
  const r = client(e).post(path).set(auth);
  parts.variants?.forEach((b, i) => r.attach('variants', b, { filename: `v${i}.webp`, contentType: 'image/webp' }));
  if (parts.width !== undefined) r.field('width', String(parts.width));
  if (parts.height !== undefined) r.field('height', String(parts.height));
  if (parts.field) r.attach(parts.fieldName ?? 'image', parts.field, { filename: parts.fileName ?? 'f.bin' });
  return r;
}

const good = () => ({ variants: [webp(480, 320), webp(960, 640), webp(1200, 800, 0, 'vp8l')], width: 1200, height: 800 });

describe('section image upload', () => {
  it('writes every variant in ONE commit and stores the image on the document', async () => {
    const id = await heroId();
    const r = await upload(`/api/v1/sections/${id}/image`, good()).expect(200);
    expect(gh.commitCount()).toBe(1);
    const files = gh.files();
    expect(files).toHaveLength(3);
    expect(files.every((f) => /^media\/sections\/[a-f0-9]{32}\/(480|960|1200)\.webp$/.test(f))).toBe(true);
    const doc = await db.m.Section.findById(id).lean();
    expect(doc?.image).toMatchObject({ width: 1200, height: 800 });
    expect(doc?.image?.variants.map((v) => v.width)).toEqual([480, 960, 1200]);
    expect(Object.keys(r.body.data.image.webp)).toEqual(['480', '960', '1200']);
    expect(r.body.data.image.url).toMatch(/^\/media\/sections\/[a-f0-9]{32}\/1200\.webp$/);
    expect((await db.m.SiteState.findById('site').lean())?.dirty_at).toBeTruthy();
  });

  it('rejects wrong magic bytes, whatever the name or type says', async () => {
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, { variants: [Buffer.from('%PDF-1.4 not an image')], width: 100, height: 100 }).expect(422);
    await upload(`/api/v1/sections/${id}/image`, { variants: [jpeg()], width: 100, height: 100 }).expect(422); // real jpeg, but variants must be webp
    expect(gh.fetch).not.toHaveBeenCalled();
    expect((await db.m.Section.findById(id).lean())?.image).toBeNull();
  });

  it('rejects too many pixels, a missing size and too many variants', async () => {
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, { variants: [webp(480, 320)], width: 7000, height: 6000 }).expect(422);
    await upload(`/api/v1/sections/${id}/image`, { variants: [webp(480, 320)] }).expect(422);
    await upload(`/api/v1/sections/${id}/image`, { variants: [webp(480, 1), webp(960, 1), webp(1200, 1), webp(1400, 1)], width: 1600, height: 1 }).expect(422);
    expect(gh.fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized upload by Content-Length before reading it, and files over UPLOADS_MAX_MB', async () => {
    const id = await heroId();
    const big = webp(480, 320, 4 * 1024 * 1024);
    await upload(`/api/v1/sections/${id}/image`, { variants: [big], width: 480, height: 320 }, { ...env, UPLOADS_MAX_MB: '1' }).expect(413);
    await upload(`/api/v1/sections/${id}/image`, { variants: [webp(480, 320, 1_100_000)], width: 480, height: 320 }, { ...env, UPLOADS_MAX_MB: '1' }).expect(422);
    expect(gh.fetch).not.toHaveBeenCalled();
  });

  it('retries when the branch moved', async () => {
    gh.state.failRefUpdates = 2;
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, good()).expect(200);
    expect(gh.files()).toHaveLength(3);
    expect(gh.state.calls.filter((c) => c.method === 'PATCH')).toHaveLength(3);
  });

  it('gives up after 3 retries', async () => {
    gh.state.failRefUpdates = 99;
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, good()).expect(409);
    expect(gh.state.calls.filter((c) => c.method === 'PATCH')).toHaveLength(4);
    expect((await db.m.Section.findById(id).lean())?.image).toBeNull();
  });

  it('reports a GitHub failure without saving', async () => {
    gh.state.failWith = 500;
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, good()).expect(502);
    expect((await db.m.Section.findById(id).lean())?.image).toBeNull();
  });

  it('is unavailable without a token', async () => {
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, good(), { ...env, GITHUB_REPO_TOKEN: '' }).expect(503);
  });

  it('replacement schedules removal of the old files in a second commit', async () => {
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, good()).expect(200);
    const first = gh.files();
    await upload(`/api/v1/sections/${id}/image`, good()).expect(200);
    await drainDeferred();
    expect(gh.commitCount()).toBe(3); // add, add, remove
    const now = gh.files();
    expect(now).toHaveLength(3);
    expect(now.some((f) => first.includes(f))).toBe(false);
  });

  it('delete clears the document and removes the files', async () => {
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, good()).expect(200);
    const r = await client(env).delete(`/api/v1/sections/${id}/image`).set(auth).expect(200);
    expect(r.body.data.image).toBeNull();
    await drainDeferred();
    expect(gh.files()).toEqual([]);
  });

  it('enforces MEDIA_MAX_FILES from stored documents', async () => {
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, good(), { ...env, MEDIA_MAX_FILES: '3' }).expect(200);
    const other = (await db.m.Section.findOne({ key: 'about' }).lean())!._id;
    await upload(`/api/v1/sections/${other}/image`, good(), { ...env, MEDIA_MAX_FILES: '3' }).expect(409);
    await upload(`/api/v1/sections/${id}/image`, good(), { ...env, MEDIA_MAX_FILES: '3' }).expect(200); // replacing frees its own files
  });

  it('forbids uploads without sections.update', async () => {
    const v = await actingAs(db.m, 'viewer', ['sections.view']);
    const id = await heroId();
    await client(env).post(`/api/v1/sections/${id}/image`).set(v.auth).expect(403);
    await client(env).delete(`/api/v1/sections/${id}/image`).set(v.auth).expect(403);
    expect(gh.fetch).not.toHaveBeenCalled();
  });

  it('hero panel image upload works', async () => {
    await upload('/api/v1/hero/image', good()).expect(403); // editor has no hero.update
    const h = await actingAs(db.m, 'hero', ['hero.update']);
    const r = client(env).post('/api/v1/hero/image').set(h.auth);
    good().variants.forEach((b) => r.attach('variants', b, { filename: 'v.webp' }));
    await r.field('width', '1200').field('height', '800').expect(200);
  });
});

describe('settings logo and favicon', () => {
  it('uploads, replaces and removes the logo', async () => {
    await upload('/api/v1/settings/logo', { variants: [webp(480, 480)], width: 600, height: 600 }).expect(200);
    expect(gh.files()[0]).toMatch(/^media\/site\/[a-f0-9]{32}\/480\.webp$/);
    const r = await client(env).delete('/api/v1/settings/logo').set(auth).expect(200);
    expect(r.body.data.logo).toBeNull();
    await drainDeferred();
    expect(gh.files()).toEqual([]);
  });

  it('accepts an .ico or .png favicon only, up to 100 KB, but not as a logo', async () => {
    await upload('/api/v1/settings/favicon', { field: ico(), fileName: 'favicon.ico' }).expect(200);
    expect(gh.files()[0]).toMatch(/^media\/site\/[a-f0-9]{32}\/favicon\.ico$/);
    await upload('/api/v1/settings/favicon', { field: png(), fileName: 'f.png' }).expect(200);
    await upload('/api/v1/settings/favicon', { field: jpeg(), fileName: 'f.ico' }).expect(422);
    await upload('/api/v1/settings/favicon', { field: Buffer.concat([ico(), Buffer.alloc(101 * 1024)]), fileName: 'f.ico' }).expect(422);
    await upload('/api/v1/settings/logo', { field: ico(), fileName: 'logo.ico' }).expect(422);
  });
});

describe('public reads', () => {
  it('never call GitHub', async () => {
    const id = await heroId();
    await upload(`/api/v1/sections/${id}/image`, good()).expect(200);
    gh.fetch.mockClear();
    await client(env).get('/api/v1/public/sections').expect(200);
    await client(env).get('/api/v1/public/settings').expect(200);
    await client(env).get('/api/v1/sections').set(auth).expect(200);
    expect(gh.fetch).not.toHaveBeenCalled();
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.ts';
import { nextId } from '../src/models.ts';
import { drainDeferred } from '../src/runtime.ts';
import { seedAccess } from '../src/seed/seed.ts';
import { actingAs, client, useDb } from './helpers.ts';
import { fakeGithub, webp } from './media-helpers.ts';

const db = useDb();
const env: Partial<Env> = { GITHUB_REPO: 'o/r', GITHUB_REPO_TOKEN: 'tok' };
let gh: ReturnType<typeof fakeGithub>;

beforeAll(() => db.reset());
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  await seedAccess(db.m, {});
  gh = fakeGithub();
  vi.stubGlobal('fetch', gh.fetch);
});
afterEach(async () => {
  await drainDeferred();
  vi.unstubAllGlobals();
});

const day = 86_400_000;
const cat = async (fields: Record<string, unknown>) => db.m.Category.create({ _id: await nextId(db.m, 'categories'), ...fields });
const post = async (fields: Record<string, unknown>) => db.m.Post.create({ _id: await nextId(db.m, 'posts'), ...fields });
const dirtyTags = async () => (await db.m.SiteState.findById('site').lean())?.tags ?? [];

describe('blog access', () => {
  it('requires authentication and the module permission', async () => {
    await client().get('/api/v1/posts').expect(401);
    await client().get('/api/v1/categories').expect(401);
    const u = await actingAs(db.m, 'nobody');
    await client().get('/api/v1/posts').set(u.auth).expect(403);
    await client().get('/api/v1/categories').set(u.auth).expect(403);
  });

  it('forbids writes without the matching permission', async () => {
    const p = await post({ title: 'T', slug: 't' });
    const c = await cat({ name: 'C', slug: 'c' });
    const u = await actingAs(db.m, 'viewer', ['posts.view', 'categories.view']);
    await client().post('/api/v1/posts').set(u.auth).send({ title: 'x', slug: 'x' }).expect(403);
    await client().patch(`/api/v1/posts/${p._id}`).set(u.auth).send({ title: 'x' }).expect(403);
    await client().delete(`/api/v1/posts/${p._id}`).set(u.auth).expect(403);
    await client().post(`/api/v1/posts/${p._id}/image`).set(u.auth).expect(403);
    await client().delete(`/api/v1/posts/${p._id}/image`).set(u.auth).expect(403);
    await client().post('/api/v1/categories').set(u.auth).send({ name: 'x', slug: 'x' }).expect(403);
    await client().patch(`/api/v1/categories/${c._id}`).set(u.auth).send({ name: 'x' }).expect(403);
    await client().delete(`/api/v1/categories/${c._id}`).set(u.auth).expect(403);
    expect(await db.m.Post.countDocuments()).toBe(1);
    expect(await db.m.Category.countDocuments()).toBe(1);
  });
});

describe('public posts', () => {
  it('serves only published, non-scheduled posts, newest first, with category filter', async () => {
    const news = await cat({ name: 'News', slug: 'news' });
    await post({ title: 'Old', slug: 'old', is_published: true, published_at: new Date(Date.now() - 2 * day), category_id: news._id });
    await post({ title: 'New', slug: 'new', is_published: true, published_at: new Date(Date.now() - day) });
    await post({ title: 'Undated', slug: 'undated', is_published: true });
    await post({ title: 'Draft', slug: 'draft', is_published: false });
    await post({ title: 'Later', slug: 'later', is_published: true, published_at: new Date(Date.now() + day) });
    const r = await client().get('/api/v1/public/posts').expect(200);
    // newest first; a published post without a date sorts after the dated ones
    expect(r.body.data.map((p: { slug: string }) => p.slug)).toEqual(['new', 'old', 'undated']);
    expect(r.body.meta).toMatchObject({ current_page: 1, per_page: 12, total: 3 });
    expect(r.body.data[1].category.slug).toBe('news');
    const f = await client().get('/api/v1/public/posts?category=news').expect(200);
    expect(f.body.data).toHaveLength(1);
    expect((await client().get('/api/v1/public/posts?category=nope').expect(200)).body.data).toEqual([]);
    await client().get('/api/v1/public/posts/old').expect(200);
    await client().get('/api/v1/public/posts/draft').expect(404);
    await client().get('/api/v1/public/posts/later').expect(404);
  });

  it('paginates 12 per page and honours ?lang', async () => {
    for (let i = 0; i < 13; i++) await post({ title: `P${i}`, slug: `p${i}`, title_2nd: `বি${i}`, is_published: true, published_at: new Date(Date.now() - i * 1000) });
    const p2 = await client().get('/api/v1/public/posts?page=2').expect(200);
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.meta).toMatchObject({ current_page: 2, last_page: 2, total: 13 });
    const bn = await client({ LOCALE_SUPPORTED: 'en,bn' }).get('/api/v1/public/posts/p0?lang=bn').expect(200);
    expect(bn.body.data.title).toBe('বি0');
    expect(bn.body.data).not.toHaveProperty('title_2nd');
  });

  it('lists categories in order', async () => {
    await cat({ name: 'B', slug: 'b', sort_order: 2 });
    await cat({ name: 'A', slug: 'a', sort_order: 1 });
    const r = await client().get('/api/v1/public/categories').expect(200);
    expect(r.body.data.map((c: { slug: string }) => c.slug)).toEqual(['a', 'b']);
  });
});

describe('posts admin', () => {
  const editor = () => actingAs(db.m, 'editor', ['posts.view', 'posts.create', 'posts.update', 'posts.delete']);

  it('sanitises the body of both languages on create and update', async () => {
    const u = await editor();
    const dirty = '<p>Hello <strong>world</strong></p><script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">bad</a> <a href="https://example.com" target="_blank">ok</a><img src="https://example.com/a.png" onerror="y()"><iframe src="https://evil.test"></iframe>';
    const r = await client().post('/api/v1/posts').set(u.auth).send({ title: 'T', slug: 't', body: dirty, body_2nd: dirty }).expect(201);
    for (const f of ['body', 'body_2nd']) {
      const html = r.body.data[f] as string;
      expect(html).toContain('<p>Hello <strong>world</strong></p>');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('rel="noopener noreferrer"');
      for (const bad of ['<script', 'alert(1)', 'javascript:', 'onclick', 'onerror', '<iframe']) expect(html).not.toContain(bad);
    }
    const upd = await client().patch(`/api/v1/posts/${r.body.data.id}`).set(u.auth).send({ body: '<p>x</p><script>1</script>' }).expect(200);
    expect(upd.body.data.body).toBe('<p>x</p>');
  });

  it('stores an empty body as null', async () => {
    const u = await editor();
    const r = await client().post('/api/v1/posts').set(u.auth).send({ title: 'T', slug: 't', body: '   ' }).expect(201);
    expect(r.body.data.body).toBeNull();
  });

  it('creates, shows, updates and deletes a post with a category', async () => {
    const c = await cat({ name: 'News', slug: 'news' });
    const u = await editor();
    const created = await client().post('/api/v1/posts').set(u.auth).send({ title: 'T', title_2nd: 'শিরোনাম', slug: 't', category_id: c._id }).expect(201);
    expect(created.body.data).toMatchObject({ title_2nd: 'শিরোনাম', is_published: false, status: 'draft', category: { slug: 'news' } });
    const id = created.body.data.id;
    await client().get(`/api/v1/posts/${id}`).set(u.auth).expect(200);
    const list = await client().get('/api/v1/posts').set(u.auth).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.per_page).toBe(20);
    const upd = await client().patch(`/api/v1/posts/${id}`).set(u.auth).send({ is_published: true, category_id: null }).expect(200);
    expect(upd.body.data).toMatchObject({ is_published: true, category: null });
    await client().delete(`/api/v1/posts/${id}`).set(u.auth).expect(204);
    expect(await db.m.Post.countDocuments()).toBe(0);
    expect(await dirtyTags()).toContain('posts');
  });

  it('keeps posts when their category is deleted', async () => {
    const c = await cat({ name: 'News', slug: 'news' });
    const p = await post({ title: 'T', slug: 't', category_id: c._id });
    const u = await actingAs(db.m, 'cat-editor', ['categories.delete']);
    await client().delete(`/api/v1/categories/${c._id}`).set(u.auth).expect(204);
    expect((await db.m.Post.findById(p._id).lean())?.category_id).toBeNull();
  });

  it('generates a unique slug from the title when none is sent', async () => {
    const u = await editor();
    const a = await client().post('/api/v1/posts').set(u.auth).send({ title: 'Hello, Wörld!' }).expect(201);
    const b = await client().post('/api/v1/posts').set(u.auth).send({ title: 'Hello, Wörld!' }).expect(201);
    const c = await client().post('/api/v1/posts').set(u.auth).send({ title: 'আমাদের খবর' }).expect(201);
    expect([a.body.data.slug, b.body.data.slug, c.body.data.slug]).toEqual(['hello-world', 'hello-world-2', 'post']);
  });

  it('freezes the slug once the post is published, but not before', async () => {
    const u = await editor();
    const r = await client().post('/api/v1/posts').set(u.auth).send({ title: 'T', slug: 'first' }).expect(201);
    await client().patch(`/api/v1/posts/${r.body.data.id}`).set(u.auth).send({ slug: 'second' }).expect(200); // draft: free to change
    await client().patch(`/api/v1/posts/${r.body.data.id}`).set(u.auth).send({ status: 'published' }).expect(200);
    const bad = await client().patch(`/api/v1/posts/${r.body.data.id}`).set(u.auth).send({ slug: 'third' }).expect(422);
    expect(Object.keys(bad.body.error.details)).toEqual(['slug']);
    await client().patch(`/api/v1/posts/${r.body.data.id}`).set(u.auth).send({ slug: 'second', title: 'Same slug is fine' }).expect(200);
  });

  it('validates input', async () => {
    await post({ title: 'T', slug: 'taken' });
    await cat({ name: 'C', slug: 'taken' });
    const u = await actingAs(db.m, 'e', ['posts.create', 'posts.update', 'categories.create']);
    const bad = await client().post('/api/v1/posts').set(u.auth).send({ slug: 'Not A Slug', category_id: 999, is_published: 'maybe', published_at: 'soon' }).expect(422);
    expect(Object.keys(bad.body.error.details).sort()).toEqual(['category_id', 'is_published', 'published_at', 'slug', 'title']);
    const dup = await client().post('/api/v1/posts').set(u.auth).send({ title: 'T', slug: 'taken' }).expect(422);
    expect(Object.keys(dup.body.error.details)).toEqual(['slug']);
    const c = await client().post('/api/v1/categories').set(u.auth).send({ slug: 'taken' }).expect(422);
    expect(Object.keys(c.body.error.details).sort()).toEqual(['name', 'slug']);
  });

  it('maps status to is_published and stores SEO fields in both languages', async () => {
    const u = await editor();
    const r = await client().post('/api/v1/posts').set(u.auth).send({ title: 'T', slug: 'seo-post', status: 'published', seo_title: 'S', seo_title_2nd: 'S2', seo_description: 'D' }).expect(201);
    expect(r.body.data).toMatchObject({ status: 'published', is_published: true, seo_title_2nd: 'S2' });
    const d = await client().patch(`/api/v1/posts/${r.body.data.id}`).set(u.auth).send({ status: 'draft' }).expect(200);
    expect(d.body.data).toMatchObject({ status: 'draft', is_published: false });
    const bad = await client().patch(`/api/v1/posts/${r.body.data.id}`).set(u.auth).send({ status: 'archived', seo_title: 'x'.repeat(71) }).expect(422);
    expect(Object.keys(bad.body.error.details).sort()).toEqual(['seo_title', 'status']);
  });

  it('uploads and removes a post image', async () => {
    const p = await post({ title: 'T', slug: 't' });
    const u = await actingAs(db.m, 'img', ['posts.update']);
    const r = client(env).post(`/api/v1/posts/${p._id}/image`).set(u.auth);
    r.attach('variants', webp(480, 320), 'a.webp').attach('variants', webp(960, 640), 'b.webp').field('width', '960').field('height', '640');
    const up = await r.expect(200);
    expect(up.body.data.image.url).toMatch(/^\/media\/posts\/[a-f0-9]{32}\/960\.webp$/);
    const del = await client(env).delete(`/api/v1/posts/${p._id}/image`).set(u.auth).expect(200);
    expect(del.body.data.image).toBeNull();
    await drainDeferred();
    expect(gh.files()).toEqual([]);
  });
});

describe('categories admin', () => {
  it('manages categories', async () => {
    const u = await actingAs(db.m, 'e', ['categories.view', 'categories.create', 'categories.update']);
    const r = await client().post('/api/v1/categories').set(u.auth).send({ name: 'News', name_2nd: 'খবর', slug: 'news' }).expect(201);
    expect(r.body.data.sort_order).toBe(0);
    const id = r.body.data.id;
    const upd = await client().patch(`/api/v1/categories/${id}`).set(u.auth).send({ slug: 'latest' }).expect(200);
    expect(upd.body.data.slug).toBe('latest');
    await client().get(`/api/v1/categories/${id}`).set(u.auth).expect(200);
    expect(await dirtyTags()).toContain('categories');
  });
});

describe('dashboard', () => {
  it('counts what the user may view, plus unread messages', async () => {
    await post({ title: 'T', slug: 't' });
    await db.m.ContactMessage.create({ _id: 1, name: 'a', email: 'a@b.test', message: 'm' });
    await db.m.ContactMessage.create({ _id: 2, name: 'b', email: 'a@b.test', message: 'm', read_at: new Date() });
    await client().get('/api/v1/dashboard').expect(401);
    const none = await actingAs(db.m, 'none', ['dashboard.view']);
    expect((await client().get('/api/v1/dashboard').set(none.auth).expect(200)).body.data).toEqual({});
    const some = await actingAs(db.m, 'some', ['dashboard.view', 'posts.view', 'contact.view']);
    expect((await client().get('/api/v1/dashboard').set(some.auth).expect(200)).body.data).toEqual({ posts: 1, unread_messages: 1 });
    await client().get('/api/v1/dashboard').set((await actingAs(db.m, 'nodash', ['posts.view'])).auth).expect(403);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.ts';
import { dailyTick, publishNow, publishTick, recordDispatch } from '../src/publish/pipeline.ts';
import { seedAccess } from '../src/seed/seed.ts';
import { markDirty } from '../src/support/markDirty.ts';
import { actingAs, client, testEnv, useDb } from './helpers.ts';

const db = useDb();
const env: Env = testEnv({ GITHUB_REPO: 'o/r', GITHUB_REPO_TOKEN: 'secret-token', GITHUB_WORKFLOW_FILE: 'deploy.yml', GITHUB_REF: 'main' });
let fetchMock: ReturnType<typeof vi.fn>;
const MIN = 60_000;
// Anchored to the real clock because the Mongoose plugin stamps markDirty with it; every other time is injected.
const T0 = new Date(Math.floor(Date.now() / MIN) * MIN);
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

beforeAll(() => db.reset());
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  await seedAccess(db.m, {});
  await db.m.SiteState.deleteMany({}); // seeding marks content dirty; every test starts clean
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const state = () => db.m.SiteState.findById('site').lean();
/** markDirty stamps the real clock, so tests set dirty_at explicitly to the injected time. */
const setDirty = (d: Date | null) => db.m.SiteState.updateOne({ _id: 'site' }, { $set: { dirty_at: d, tags: d ? ['faqs'] : [] } }, { upsert: true });
const tick = (now: Date, over: Partial<Env> = {}) => publishTick({ ...env, ...over }, db.m, db.conn, now);

describe('markDirty', () => {
  it('records dirty_at and merges tags', async () => {
    await markDirty(db.conn, ['faqs']);
    await markDirty(db.conn, ['posts', 'faqs']);
    const s = await state();
    expect(s!.dirty_at).toBeInstanceOf(Date);
    expect([...s!.tags].sort()).toEqual(['faqs', 'posts']);
  });
});

describe('publishTick', () => {
  it('does nothing while the site is clean', async () => {
    expect(await tick(at(0))).toEqual({ flipped: false, dispatched: false, skipped: 'clean' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await state())!.last_run_at).toEqual(at(0));
  });

  it('waits for a quiet period after the last change', async () => {
    await setDirty(at(0));
    expect((await tick(at(1))).skipped).toBe('quiet'); // 1 minute old, quiet period is 2
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await tick(at(2))).dispatched).toBe(true);
  });

  it('dispatches the workflow with the token, ref and file, then clears the flag', async () => {
    await setDirty(at(0));
    const r = await tick(at(15));
    expect(r.dispatched).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/o/r/actions/workflows/deploy.yml/dispatches');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(init.body)).toEqual({ ref: 'main' });
    const s = await state();
    expect(s!.dirty_at).toBeNull();
    expect(s!.tags).toEqual([]);
    expect(s!.last_dispatched_at).toEqual(at(15));
  });

  it('debounces: no second dispatch inside PUBLISH_DEBOUNCE_MINUTES (default 5)', async () => {
    await setDirty(at(0));
    await tick(at(15));
    await setDirty(at(16));
    expect((await tick(at(18))).skipped).toBe('debounce'); // dispatched 3 minutes ago
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await tick(at(21))).dispatched).toBe(true); // 6 minutes after the first
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await setDirty(at(22));
    expect((await tick(at(30), { PUBLISH_DEBOUNCE_MINUTES: '60' })).skipped).toBe('debounce');
  });

  it('keeps the flag when something changed while the build was being started (compare-and-set)', async () => {
    await setDirty(at(0));
    fetchMock.mockImplementation(async () => {
      await setDirty(at(14)); // a change lands during the dispatch
      return new Response(null, { status: 204 });
    });
    expect((await tick(at(15))).dispatched).toBe(true);
    const s = await state();
    expect(s!.dirty_at).toEqual(at(14)); // not cleared
    expect(s!.last_dispatched_at).toEqual(at(15));
  });

  it('recordDispatch clears only when the timestamp still matches', async () => {
    await setDirty(at(0));
    expect(await recordDispatch(db.m, at(5), at(10))).toBe(false); // stale value
    expect((await state())!.dirty_at).toEqual(at(0));
    expect(await recordDispatch(db.m, at(0), at(10))).toBe(true);
    expect((await state())!.dirty_at).toBeNull();
  });

  it('keeps the flag and throws when GitHub refuses; never leaks the token', async () => {
    await setDirty(at(0));
    fetchMock.mockImplementation(async () => new Response('{"message":"Bad credentials"}', { status: 401 }));
    const err = await tick(at(15)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain('secret-token');
    expect((await state())!.dirty_at).toEqual(at(0));
    expect((await state())!.last_dispatched_at ?? null).toBeNull();
  });

  it('skips quietly when GitHub is not configured', async () => {
    await setDirty(at(0));
    expect((await tick(at(15), { GITHUB_REPO_TOKEN: '' })).skipped).toBe('unconfigured');
    expect((await state())!.dirty_at).toEqual(at(0));
  });

  it('marks posts dirty when a scheduled post became public since the last run', async () => {
    await db.m.SiteState.updateOne({ _id: 'site' }, { $set: { last_run_at: at(0) } }, { upsert: true });
    await db.m.Post.create({ _id: 1, title: 'Soon', slug: 'soon', is_published: true, published_at: at(10) });
    await db.m.Post.create({ _id: 2, title: 'Draft', slug: 'draft', is_published: false, published_at: at(10) });
    await db.m.Post.create({ _id: 3, title: 'Later', slug: 'later', is_published: true, published_at: at(40) });
    await db.m.Post.create({ _id: 4, title: 'Before', slug: 'before', is_published: true, published_at: at(-5) });
    await db.m.SiteState.updateOne({ _id: 'site' }, { $set: { dirty_at: null, tags: [] } });
    const hold = { PUBLISH_QUIET_MINUTES: '10000' }; // keep the flag so the tags can be inspected
    const r = await tick(at(15), hold);
    expect(r.flipped).toBe(true);
    expect((await state())!.tags).toContain('posts');
    expect((await state())!.dirty_at).toBeInstanceOf(Date);
    // the next run has nothing new to flip
    await db.m.SiteState.updateOne({ _id: 'site' }, { $set: { dirty_at: null, tags: [] } });
    expect((await tick(at(30), hold)).flipped).toBe(false); // post 3 is due at 40
    expect((await tick(at(45), hold)).flipped).toBe(true);
  });
});

describe('dailyTick', () => {
  it('pings Atlas, records last_ping_at and cleans expired captchas and old used refresh tokens', async () => {
    const now = at(0);
    const day = 86_400_000;
    await db.m.Captcha.create({ _id: 'old', answer: 1, expires_at: new Date(now.getTime() - 1000) });
    await db.m.Captcha.create({ _id: 'live', answer: 1, expires_at: new Date(now.getTime() + 600_000) });
    const base = { user_id: 1, family_id: 'f', expires_at: new Date(now.getTime() + day) };
    await db.m.RefreshToken.create({ _id: 1, token_hash: 'a', used_at: new Date(now.getTime() - 31 * day), ...base });
    await db.m.RefreshToken.create({ _id: 2, token_hash: 'b', used_at: new Date(now.getTime() - 2 * day), ...base });
    await db.m.RefreshToken.create({ _id: 3, token_hash: 'c', used_at: null, ...base });
    await dailyTick(db.m, db.conn, now);
    expect((await state())!.last_ping_at).toEqual(now);
    expect((await db.m.Captcha.find({}).lean()).map((c) => c._id)).toEqual(['live']);
    expect((await db.m.RefreshToken.find({}).sort({ _id: 1 }).lean()).map((t) => t._id)).toEqual([2, 3]);
  });
});

describe('site endpoints', () => {
  it('status needs site.view and reports dirty and last_dispatched_at', async () => {
    await client().get('/api/v1/site/status').expect(401);
    await client().get('/api/v1/site/status').set((await actingAs(db.m, 'nobody')).auth).expect(403);
    const u = await actingAs(db.m, 'viewer', ['site.view']);
    expect((await client().get('/api/v1/site/status').set(u.auth).expect(200)).body.data).toEqual({ dirty: false, last_dispatched_at: null });
    await markDirty(db.conn, ['faqs']);
    expect((await client().get('/api/v1/site/status').set(u.auth).expect(200)).body.data.dirty).toBe(true);
  });

  it('publish needs site.publish and dispatches immediately', async () => {
    const e = { GITHUB_REPO: 'o/r', GITHUB_REPO_TOKEN: 't' };
    await client(e).post('/api/v1/site/publish').expect(401);
    const viewer = await actingAs(db.m, 'viewer', ['site.view']);
    await client(e).post('/api/v1/site/publish').set(viewer.auth).expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
    await markDirty(db.conn, ['faqs']);
    const u = await actingAs(db.m, 'publisher', ['site.publish', 'site.view']);
    const r = await client(e).post('/api/v1/site/publish').set(u.auth).expect(202);
    expect(r.body.data.dispatched).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const status = await client(e).get('/api/v1/site/status').set(u.auth).expect(200);
    expect(status.body.data.dirty).toBe(false);
    expect(status.body.data.last_dispatched_at).not.toBeNull();
  });

  it('publish is throttled to one per minute', async () => {
    const e = { GITHUB_REPO: 'o/r', GITHUB_REPO_TOKEN: 't' };
    const u = await actingAs(db.m, 'publisher', ['site.publish']);
    await client(e).post('/api/v1/site/publish').set(u.auth).expect(202);
    const r = await client(e).post('/api/v1/site/publish').set(u.auth).expect(429);
    expect(r.headers['retry-after']).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('publish reports 503 when GitHub is not configured and 502 when it refuses', async () => {
    const u = await actingAs(db.m, 'publisher', ['site.publish']);
    await client().post('/api/v1/site/publish').set(u.auth).expect(503);
    await db.reset();
    await seedAccess(db.m, {});
    await db.m.SiteState.deleteMany({});
    const u2 = await actingAs(db.m, 'publisher', ['site.publish']);
    fetchMock.mockImplementation(async () => new Response('x', { status: 403 }));
    await client({ GITHUB_REPO: 'o/r', GITHUB_REPO_TOKEN: 't' }).post('/api/v1/site/publish').set(u2.auth).expect(502);
  });

  it('publishNow ignores the debounce and the quiet period', async () => {
    await setDirty(at(0));
    await recordDispatch(db.m, null, at(0));
    await publishNow(env, db.m, at(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await state())!.dirty_at).toBeNull();
  });
});

describe('CORS', () => {
  it('sends no CORS headers in production (empty list) and only exact development origins otherwise', async () => {
    const prod = await client().get('/api/v1/health').set('Origin', 'https://evil.test').expect(200);
    expect(prod.headers['access-control-allow-origin']).toBeUndefined();
    const dev = { CORS_ALLOWED_ORIGINS: 'http://localhost:28301,http://localhost:28300' };
    const ok = await client(dev).get('/api/v1/health').set('Origin', 'http://localhost:28301').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:28301');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const other = await client(dev).get('/api/v1/health').set('Origin', 'http://localhost:9999').expect(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    expect(other.headers['access-control-allow-credentials']).toBeUndefined();
    const pre = await client(dev).options('/api/v1/posts').set('Origin', 'http://localhost:28300').set('Access-Control-Request-Method', 'POST').expect(204);
    expect(pre.headers['access-control-allow-origin']).toBe('http://localhost:28300');
  });
});

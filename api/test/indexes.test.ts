import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { before, between, inList, notEq, upTo } from '../src/db.ts';
import { ensureIndexes, nextId } from '../src/models.ts';
import { CRON_DAILY, runScheduled } from '../src/scheduled.ts';
import { testEnv, useDb } from './helpers.ts';

const db = useDb();
const { m } = db;
const N = 3000;
const day = 86_400_000;

beforeAll(async () => {
  await db.reset();
  const now = Date.now();
  await m.Category.insertMany(Array.from({ length: 20 }, (_, i) => ({ _id: i + 1, name: `C${i}`, slug: `c-${i}`, sort_order: i })));
  await m.Post.insertMany(
    Array.from({ length: N }, (_, i) => ({
      _id: i + 1, title: `P${i}`, slug: `p-${i}`, category_id: (i % 20) + 1, body: 'x', is_published: i % 10 !== 0,
      published_at: i % 7 === 0 ? null : new Date(now - i * 3_600_000),
    })) as never,
  );
  await m.ContactMessage.insertMany(Array.from({ length: N }, (_, i) => ({ _id: i + 1, name: 'n', email: 'e@x.test', message: 'm', read_at: i % 3 ? new Date() : null })));
  await m.RefreshToken.insertMany(
    Array.from({ length: N }, (_, i) => ({
      _id: i + 1, user_id: (i % 50) + 1, family_id: `f${i % 500}`, token_hash: `h${i}`, expires_at: new Date(now + 30 * day),
      used_at: i % 2 ? new Date(now - 40 * day) : null, revoked_at: null,
    })),
  );
  await m.User.insertMany(Array.from({ length: 200 }, (_, i) => ({ _id: i + 1, name: `U${i}`, email: `u${i}@x.test`, password_hash: 'x', role_ids: [1] })));
  await ensureIndexes(m);
}, 120000);
afterAll(() => db.close());

/** Every stage name of the winning plan, e.g. ['LIMIT', 'FETCH', 'IXSCAN']. */
const stages = (plan: unknown): string[] => {
  const out: string[] = [];
  const walk = (p: Record<string, unknown> | undefined): void => {
    if (!p) return;
    if (typeof p.stage === 'string') out.push(p.stage);
    walk(p.inputStage as Record<string, unknown> | undefined);
    for (const s of (p.inputStages as Record<string, unknown>[] | undefined) ?? []) walk(s);
  };
  walk(plan as Record<string, unknown>);
  return out;
};
const planOf = async (q: { explain: (v: string) => PromiseLike<unknown> }) => {
  const e = (await q.explain('queryPlanner')) as Record<string, unknown>;
  return stages((e.queryPlanner as { winningPlan: unknown }).winningPlan);
};

// Queries on collections that grow without a hard bound. Each must use an index and need no in-memory sort.
const published = () => ({ is_published: true, $or: [{ published_at: null }, { published_at: upTo(new Date()) }] });
const cases: [string, () => Promise<string[]>][] = [
  ['login: users by email', () => planOf(m.User.find({ email: 'u5@x.test' }))],
  ['refresh: token by hash', () => planOf(m.RefreshToken.find({ token_hash: 'h77' }))],
  ['refresh: family revoke', () => planOf(m.RefreshToken.find({ family_id: 'f7', revoked_at: null }))],
  ['refresh: user cleanup', () => planOf(m.RefreshToken.find({ user_id: 3, expires_at: before(new Date()) }))],
  ['password change: user tokens', () => planOf(m.RefreshToken.find({ user_id: 3, revoked_at: null }))],
  ['daily: used tokens older than 30 days', () => planOf(m.RefreshToken.find({ used_at: before(new Date(Date.now() - 30 * day)) }))],
  ['public posts, newest first', () => planOf(m.Post.find(published()).sort({ published_at: -1, _id: -1 }).limit(12))],
  ['public posts of one category', () => planOf(m.Post.find({ ...published(), category_id: 4 }).sort({ published_at: -1, _id: -1 }).limit(12))],
  ['post by slug', () => planOf(m.Post.find({ slug: 'p-10', ...published() }))],
  ['posts of a category (category delete)', () => planOf(m.Post.find({ category_id: 4 }))],
  ['scheduled posts that became due', () => planOf(m.Post.find({ is_published: true, published_at: between(new Date(Date.now() - day), new Date()) }))],
  ['category by slug', () => planOf(m.Category.find({ slug: 'c-4' }))],
  ['inbox, unread first page', () => planOf(m.ContactMessage.find({ read_at: null }).sort({ _id: -1 }).limit(20))],
  ['inbox, all', () => planOf(m.ContactMessage.find({}).sort({ _id: -1 }).limit(20))],
  ['admin users list page', () => planOf(m.User.find({}).sort({ _id: 1 }).skip(15).limit(15))],
  ['users by id list', () => planOf(m.User.find({ _id: inList([1, 2, 3]) }))],
  ['slug uniqueness check excluding self', () => planOf(m.Post.find({ slug: 'p-3', _id: notEq(3) }))],
];

describe('explain plans on 3,000 posts, messages and tokens', () => {
  for (const [name, run] of cases) {
    it(name, async () => {
      const s = await run();
      expect(s.some((x) => x.endsWith('IXSCAN')), s.join(' > ')).toBe(true); // EXPRESS_IXSCAN is the fast path for unique equality
      expect(s, s.join(' > ')).not.toContain('COLLSCAN');
      expect(s, s.join(' > ')).not.toContain('SORT'); // a blocking in-memory sort
    });
  }
});

type Idx = { key: Record<string, number>; unique?: boolean; expireAfterSeconds?: number }[];
const indexesOf = async (model: { collection: { indexes(): Promise<Idx> } }): Promise<Idx> => model.collection.indexes();

describe('declared indexes', () => {
  it('has the unique indexes users.email, sections.key, posts.slug, categories.slug, roles.name and refresh_tokens.token_hash', async () => {
    const want = [[m.User, 'email'], [m.Section, 'key'], [m.Post, 'slug'], [m.Category, 'slug'], [m.Role, 'name'], [m.RefreshToken, 'token_hash']] as const;
    for (const [model, field] of want) {
      const idx = await indexesOf(model as never);
      expect(idx.some((i) => i.unique === true && Object.keys(i.key).join() === field), `${model.collection.name}.${field}`).toBe(true);
    }
  });

  it('has TTL indexes on captchas, rate_limits and refresh_tokens (expires_at)', async () => {
    for (const model of [m.Captcha, m.RateLimit, m.RefreshToken]) {
      const idx = await indexesOf(model as never);
      expect(idx.some((i) => i.expireAfterSeconds === 0 && Object.keys(i.key).join() === 'expires_at'), model.collection.name).toBe(true);
    }
  });

  it('hands out unique ids from the counters collection under concurrency', async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => nextId(m, 'probe')));
    expect(new Set(ids).size).toBe(10);
    expect(Math.max(...ids)).toBe(10);
  });

  it('the daily cron recreates an index that is missing, the 15-minute cron does not touch indexes', async () => {
    const name = 'is_published_1_published_at_-1__id_-1';
    await m.Post.collection.dropIndex(name);
    await runScheduled('*/15 * * * *', testEnv());
    expect((await indexesOf(m.Post as never)).some((i) => Object.keys(i.key).join() === 'is_published,published_at,_id')).toBe(false);
    await runScheduled(CRON_DAILY, testEnv());
    expect((await indexesOf(m.Post as never)).some((i) => Object.keys(i.key).join() === 'is_published,published_at,_id')).toBe(true);
  });

  it('createIndexes is idempotent (safe on every deploy or daily)', async () => {
    await expect(ensureIndexes(m)).resolves.toBeUndefined();
  });
});

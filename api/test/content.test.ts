import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedAccess } from '../src/seed/seed.ts';
import { bilingual } from '../src/support/bilingual.ts';
import { collapse } from '../src/support/localize.ts';
import { z } from '../src/http/validate.ts';
import { actingAs, client, useDb } from './helpers.ts';

const db = useDb();
beforeAll(() => db.reset());
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  await seedAccess(db.m, {});
});

const bn = { LOCALE_SUPPORTED: 'en,bn', LOCALE_DEFAULT: 'en' };

describe('bilingual helper', () => {
  it('adds a nullable *_2nd twin with the same max', () => {
    const s = z.strictObject(bilingual({ title: { max: 5, required: true } }));
    expect(s.safeParse({ title: 'abc', title_2nd: null }).success).toBe(true);
    expect(s.safeParse({ title_2nd: 'toolong' }).success).toBe(false);
    expect(s.safeParse({ title: '' }).success).toBe(false); // sometimes+required: not emptied
    expect(s.safeParse({}).success).toBe(true);
  });
});

describe('public ?lang', () => {
  it('collapses nested twins and falls back when the twin is empty', () => {
    expect(collapse({ a: 'x', a_2nd: 'y', b: 'p', b_2nd: '', n: [{ c: 1, c_2nd: 2 }] }, true)).toEqual({ a: 'y', b: 'p', n: [{ c: 2 }] });
    expect(collapse({ a: 'x', a_2nd: 'y' }, false)).toEqual({ a: 'x' });
  });

  it('keeps both languages without ?lang, one language with it, and rejects unknown values', async () => {
    await db.m.Section.updateOne({ key: 'hero' }, { $set: { title_2nd: 'স্বাগতম' } });
    const both = await client(bn).get('/api/v1/public/sections').expect(200);
    expect(both.body.data[0]).toMatchObject({ title: 'Welcome', title_2nd: 'স্বাগতম' });
    const second = await client(bn).get('/api/v1/public/sections?lang=bn').expect(200);
    expect(second.body.data[0].title).toBe('স্বাগতম');
    expect(second.body.data[0]).not.toHaveProperty('title_2nd');
    expect(second.body.data[1].title).toBe('About us'); // empty twin falls back
    const first = await client(bn).get('/api/v1/public/sections?lang=en').expect(200);
    expect(first.body.data[0].title).toBe('Welcome');
    expect(first.body.data[0]).not.toHaveProperty('title_2nd');
    const bad = await client(bn).get('/api/v1/public/sections?lang=xx').expect(422);
    expect(Object.keys(bad.body.error.details)).toEqual(['lang']);
  });
});

describe('settings', () => {
  it('needs auth and settings.view', async () => {
    await client().get('/api/v1/settings').expect(401);
    const u = await actingAs(db.m, 'nobody');
    await client().get('/api/v1/settings').set(u.auth).expect(403);
  });

  it('shows the seeded defaults, publicly too', async () => {
    const u = await actingAs(db.m, 'viewer', ['settings.view']);
    const r = await client().get('/api/v1/settings').set(u.auth).expect(200);
    expect(r.body.data).toMatchObject({ site_name: 'My Business', site_name_2nd: null, social_links: {} });
    expect(r.body.data.hours.mon.open).toBe('09:00');
    expect(r.body.data.hours.sun.closed).toBe(true);
    await client().get('/api/v1/public/settings').expect(200);
  });

  it('forbids update with view-only access before validating', async () => {
    const u = await actingAs(db.m, 'viewer', ['settings.view']);
    await client().patch('/api/v1/settings').set(u.auth).send({ email: 'x' }).expect(403);
  });

  it('updates partially and marks content dirty', async () => {
    const u = await actingAs(db.m, 'editor', ['settings.view', 'settings.update']);
    const r = await client().patch('/api/v1/settings').set(u.auth).send({
      site_name: 'Acme', site_name_2nd: 'এক্মি', email: 'hello@acme.test',
      hours: { mon: { open: '08:30', close: '18:00', closed: false } },
      social_links: { facebook: 'https://facebook.com/acme' },
    }).expect(200);
    expect(r.body.data).toMatchObject({ site_name: 'Acme', site_name_2nd: 'এক্মি' });
    expect(r.body.data.social_links.facebook).toBe('https://facebook.com/acme');
    const row = await db.m.Setting.findById(1).lean();
    expect(row?.tagline).toBe('Welcome');
    expect(row?.hours).toEqual({ mon: { open: '08:30', close: '18:00', closed: false } });
    const state = await db.m.SiteState.findById('site').lean();
    expect(state?.tags).toContain('settings');
    expect(state?.dirty_at).toBeTruthy();
  });

  it('rejects invalid input', async () => {
    const u = await actingAs(db.m, 'editor', ['settings.view', 'settings.update']);
    const r = await client().put('/api/v1/settings').set(u.auth).send({
      site_name: '', email: 'nope', hours: { funday: { closed: true } }, social_links: { facebook: 'not a url' },
    }).expect(422);
    expect(Object.keys(r.body.error.details).sort()).toEqual(expect.arrayContaining(['site_name', 'email']));
  });

  it('is edit-only', async () => {
    const u = await actingAs(db.m, 'editor', ['settings.view', 'settings.update']);
    await client().post('/api/v1/settings').set(u.auth).send({}).expect(405);
    await client().delete('/api/v1/settings').set(u.auth).expect(405);
  });
});

describe('sections', () => {
  it('needs auth and sections.view', async () => {
    await client().get('/api/v1/sections').expect(401);
    const u = await actingAs(db.m, 'nobody');
    await client().get('/api/v1/sections').set(u.auth).expect(403);
  });

  it('lists nine sections in order, shows one, public lists visible only', async () => {
    const u = await actingAs(db.m, 'viewer', ['sections.view']);
    const r = await client().get('/api/v1/sections').set(u.auth).expect(200);
    expect(r.body.data).toHaveLength(9);
    expect(r.body.data[0]).toMatchObject({ key: 'hero', image: null });
    const about = r.body.data.find((s: { key: string }) => s.key === 'about');
    const one = await client().get(`/api/v1/sections/${about.id}`).set(u.auth).expect(200);
    expect(one.body.data).toMatchObject({ key: 'about', is_visible: true });
    const pub = await client().get('/api/v1/public/sections').expect(200);
    expect(pub.body.data.map((s: { key: string }) => s.key)).toEqual(['hero', 'about', 'services', 'contact']);
  });

  it('updates both languages, rejects the immutable key', async () => {
    const u = await actingAs(db.m, 'editor', ['sections.view', 'sections.update']);
    const about = await db.m.Section.findOne({ key: 'about' }).lean();
    await client().patch(`/api/v1/sections/${about!._id}`).set(u.auth).send({ key: 'hacked', title: 'About' }).expect(422);
    const r = await client().patch(`/api/v1/sections/${about!._id}`).set(u.auth)
      .send({ title: 'About', title_2nd: 'সম্পর্কে', content: 'Hello', is_visible: false, sort_order: 5 }).expect(200);
    expect(r.body.data).toMatchObject({ key: 'about', title_2nd: 'সম্পর্কে', is_visible: false, sort_order: 5 });
    expect((await db.m.SiteState.findById('site').lean())?.tags).toContain('sections');
  });

  it('forbids update without sections.update and validates input', async () => {
    const v = await actingAs(db.m, 'viewer', ['sections.view']);
    const about = await db.m.Section.findOne({ key: 'about' }).lean();
    await client().patch(`/api/v1/sections/${about!._id}`).set(v.auth).send({ title: 'x' }).expect(403);
    const e = await actingAs(db.m, 'editor', ['sections.view', 'sections.update']);
    const r = await client().patch(`/api/v1/sections/${about!._id}`).set(e.auth).send({ title: '', sort_order: -1, is_visible: 'maybe' }).expect(422);
    expect(Object.keys(r.body.error.details).sort()).toEqual(['is_visible', 'sort_order', 'title']);
  });

  it('has no create or delete', async () => {
    const e = await actingAs(db.m, 'editor', ['sections.view', 'sections.update']);
    await client().post('/api/v1/sections').set(e.auth).send({}).expect(405);
    await client().delete('/api/v1/sections/1').set(e.auth).expect(405);
  });

  it('reorders', async () => {
    const e = await actingAs(db.m, 'editor', ['sections.view', 'sections.update']);
    const rows = await db.m.Section.find({}).sort({ sort_order: 1 }).lean();
    const ids = rows.map((s) => s._id).reverse();
    await client().put('/api/v1/sections/reorder').set(e.auth).send({ ids }).expect(200);
    const after = await db.m.Section.find({}).sort({ sort_order: 1 }).lean();
    expect(after.map((s) => s._id)).toEqual(ids);
    await client().put('/api/v1/sections/reorder').set(e.auth).send({ ids: [9999] }).expect(422);
  });

  it('hero and about panels use their own permissions', async () => {
    const h = await actingAs(db.m, 'hero-editor', ['hero.view', 'hero.update']);
    await client().get('/api/v1/hero').set(h.auth).expect(200);
    await client().patch('/api/v1/hero').set(h.auth).send({ title: 'Hi' }).expect(200);
    await client().get('/api/v1/about').set(h.auth).expect(403);
  });
});

describe('seed', () => {
  it('is idempotent and never overwrites edits', async () => {
    await db.m.Setting.updateOne({ _id: 1 }, { $set: { site_name: 'Mine' } });
    await db.m.Section.updateOne({ key: 'hero' }, { $set: { title: 'Edited' } });
    await seedAccess(db.m, {});
    expect((await db.m.Setting.findById(1).lean())?.site_name).toBe('Mine');
    expect((await db.m.Section.findOne({ key: 'hero' }).lean())?.title).toBe('Edited');
    expect(await db.m.Section.countDocuments()).toBe(9);
  });
});

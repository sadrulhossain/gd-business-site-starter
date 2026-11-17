import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.ts';
import { nextId, type Models } from '../src/models.ts';
import { drainDeferred } from '../src/runtime.ts';
import { seedAccess } from '../src/seed/seed.ts';
import { seedDemo } from '../src/seed/demo.ts';
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

type Key = 'Faq' | 'Service' | 'Testimonial' | 'TeamMember' | 'GalleryItem';
interface Mod {
  path: string; model: Key; tag: string; publicPath: string;
  sample: Record<string, unknown>; text: string; second: string; changeField: string;
  required: string[]; image: boolean; dir: string;
}
const mods: Mod[] = [
  { path: 'faqs', model: 'Faq', tag: 'faqs', publicPath: 'faqs', sample: { question: 'Q?', answer: 'A.' }, text: 'question', second: 'question_2nd', changeField: 'answer', required: ['question', 'answer'], image: false, dir: '' },
  { path: 'services', model: 'Service', tag: 'services', publicPath: 'services', sample: { title: 'Consulting', description: 'We help.' }, text: 'title', second: 'title_2nd', changeField: 'description', required: ['title'], image: true, dir: 'services' },
  { path: 'testimonials', model: 'Testimonial', tag: 'testimonials', publicPath: 'testimonials', sample: { author_name: 'Ann', quote: 'Great.' }, text: 'quote', second: 'quote_2nd', changeField: 'quote', required: ['author_name', 'quote'], image: true, dir: 'testimonials' },
  { path: 'team', model: 'TeamMember', tag: 'team_members', publicPath: 'team', sample: { name: 'John', role: 'Lead' }, text: 'role', second: 'role_2nd', changeField: 'bio', required: ['name', 'role'], image: true, dir: 'team' },
  { path: 'gallery', model: 'GalleryItem', tag: 'gallery_items', publicPath: 'gallery', sample: { title: 'Office', caption: 'Our desk' }, text: 'title', second: 'title_2nd', changeField: 'caption', required: [], image: true, dir: 'gallery' },
];

const make = async (m: Models, model: Key, fields: Record<string, unknown>) => {
  const M = m[model] as unknown as { create(d: unknown): Promise<{ _id: number }>; collection: { name: string } };
  return M.create({ _id: await nextId(m, M.collection.name), ...fields });
};
const dirtyTags = async () => (await db.m.SiteState.findById('site').lean())?.tags ?? [];
const variants = () => [webp(480, 320), webp(960, 640)];
const attach = (r: ReturnType<ReturnType<typeof client>['post']>) => {
  variants().forEach((b, i) => r.attach('variants', b, { filename: `v${i}.webp` }));
  return r.field('width', '960').field('height', '640');
};

describe.each(mods)('$path', (mod) => {
  const base = `/api/v1/${mod.path}`;
  const full = (over: Record<string, unknown> = {}) => ({ ...mod.sample, ...over });

  it('requires authentication and view permission for the admin list', async () => {
    await client().get(base).expect(401);
    const u = await actingAs(db.m, 'nobody');
    await client().get(base).set(u.auth).expect(403);
  });

  it('serves only visible rows, in order, to anonymous visitors', async () => {
    await make(db.m, mod.model, full({ [mod.text]: 'B', sort_order: 2 }));
    await make(db.m, mod.model, full({ [mod.text]: 'A', sort_order: 1 }));
    await make(db.m, mod.model, full({ [mod.text]: 'Hidden', is_visible: false }));
    const r = await client().get(`/api/v1/public/${mod.publicPath}`).expect(200);
    expect(r.body.data.map((x: Record<string, unknown>) => x[mod.text])).toEqual(['A', 'B']);
  });

  it('lists hidden rows for the admin and shows one', async () => {
    const row = await make(db.m, mod.model, full({ is_visible: false }));
    const u = await actingAs(db.m, 'viewer', [`${mod.path}.view`]);
    const list = await client().get(base).set(u.auth).expect(200);
    expect(list.body.data).toHaveLength(1);
    const one = await client().get(`${base}/${row._id}`).set(u.auth).expect(200);
    expect(one.body.data.id).toBe(row._id);
    await client().get(`${base}/99999`).set(u.auth).expect(404);
  });

  it('creates with both languages and defaults, and records the tag', async () => {
    const u = await actingAs(db.m, 'editor', [`${mod.path}.create`]);
    const r = await client().post(base).set(u.auth).send(full({ [mod.second]: 'বাংলা' })).expect(201);
    expect(r.body.data).toMatchObject({ [mod.second]: 'বাংলা', is_visible: true, sort_order: 0 });
    if (mod.image) expect(r.body.data.image).toBeNull();
    expect(await dirtyTags()).toContain(mod.tag);
  });

  it('updates and deletes', async () => {
    const row = await make(db.m, mod.model, full());
    const u = await actingAs(db.m, 'editor', [`${mod.path}.update`, `${mod.path}.delete`]);
    const r = await client().patch(`${base}/${row._id}`).set(u.auth).send({ [mod.changeField]: 'Changed', is_visible: false }).expect(200);
    expect(r.body.data[mod.changeField]).toBe('Changed');
    expect(r.body.data.is_visible).toBe(false);
    await client().delete(`${base}/${row._id}`).set(u.auth).expect(204);
    expect(await (db.m[mod.model] as unknown as { countDocuments(): Promise<number> }).countDocuments()).toBe(0);
    await client().delete(`${base}/${row._id}`).set(u.auth).expect(404);
  });

  it('forbids every write without the matching permission', async () => {
    const row = await make(db.m, mod.model, full());
    const u = await actingAs(db.m, 'viewer', [`${mod.path}.view`]);
    await client().post(base).set(u.auth).send(full()).expect(403);
    await client().patch(`${base}/${row._id}`).set(u.auth).send({ [mod.changeField]: 'x' }).expect(403);
    await client().put(`${base}/${row._id}`).set(u.auth).send({ [mod.changeField]: 'x' }).expect(403);
    await client().delete(`${base}/${row._id}`).set(u.auth).expect(403);
    await client(env).post(`${base}/${row._id}/image`).set(u.auth).expect(mod.image ? 403 : 404);
    await client().get(`${base}/${row._id}`).set((await actingAs(db.m, 'nobody')).auth).expect(403);
    expect(await (db.m[mod.model] as unknown as { countDocuments(): Promise<number> }).countDocuments()).toBe(1);
  });

  it('validates input', async () => {
    const u = await actingAs(db.m, 'editor', [`${mod.path}.create`, `${mod.path}.update`]);
    const create = await client().post(base).set(u.auth).send({ sort_order: -1, is_visible: 'maybe' }).expect(422);
    expect(Object.keys(create.body.error.details).sort()).toEqual([...mod.required, 'sort_order', 'is_visible'].sort());
    const row = await make(db.m, mod.model, full());
    const field = mod.required[0];
    if (field) {
      const upd = await client().patch(`${base}/${row._id}`).set(u.auth).send({ [field]: '' }).expect(422);
      expect(Object.keys(upd.body.error.details)).toEqual([field]);
    }
  });

  it('honours ?lang on public reads', async () => {
    await make(db.m, mod.model, full({ [mod.text]: 'One', [mod.second]: 'এক' }));
    const both = await client({ LOCALE_SUPPORTED: 'en,bn' }).get(`/api/v1/public/${mod.publicPath}`).expect(200);
    expect(both.body.data[0]).toMatchObject({ [mod.text]: 'One', [mod.second]: 'এক' });
    const bn = await client({ LOCALE_SUPPORTED: 'en,bn' }).get(`/api/v1/public/${mod.publicPath}?lang=bn`).expect(200);
    expect(bn.body.data[0][mod.text]).toBe('এক');
    expect(bn.body.data[0]).not.toHaveProperty(mod.second);
  });

  if (mod.image) {
    it('uploads, replaces and removes the image', async () => {
      const row = await make(db.m, mod.model, full());
      const u = await actingAs(db.m, 'editor', [`${mod.path}.update`]);
      const up = () => attach(client(env).post(`${base}/${row._id}/image`).set(u.auth));
      const r = await up().expect(200);
      expect(r.body.data.image.url).toMatch(new RegExp(`^/media/${mod.dir}/[a-f0-9]{32}/960\\.webp$`));
      const first = gh.files();
      expect(first).toHaveLength(2);
      await up().expect(200);
      await drainDeferred();
      expect(gh.files().some((f) => first.includes(f))).toBe(false);
      const del = await client(env).delete(`${base}/${row._id}/image`).set(u.auth).expect(200);
      expect(del.body.data.image).toBeNull();
      await drainDeferred();
      expect(gh.files()).toEqual([]);
    });

    it('forbids image changes without update and rejects non-images', async () => {
      const row = await make(db.m, mod.model, full());
      const v = await actingAs(db.m, 'viewer', [`${mod.path}.view`]);
      await attach(client(env).post(`${base}/${row._id}/image`).set(v.auth)).expect(403);
      await client(env).delete(`${base}/${row._id}/image`).set(v.auth).expect(403);
      const e = await actingAs(db.m, 'editor', [`${mod.path}.update`]);
      await client(env).post(`${base}/${row._id}/image`).set(e.auth).attach('variants', Buffer.from('%PDF-1.4'), 'doc.pdf').field('width', '10').field('height', '10').expect(422);
      expect(gh.files()).toEqual([]);
    });

    it('deletes the image files together with the row', async () => {
      const row = await make(db.m, mod.model, full());
      const u = await actingAs(db.m, 'editor', [`${mod.path}.update`, `${mod.path}.delete`]);
      await attach(client(env).post(`${base}/${row._id}/image`).set(u.auth)).expect(200);
      await client(env).delete(`${base}/${row._id}`).set(u.auth).expect(204);
      await drainDeferred();
      expect(gh.files()).toEqual([]);
    });
  }
});

describe('services', () => {
  it('shows one visible service publicly and hides the others with 404', async () => {
    const shown = await make(db.m, 'Service', { title: 'Cut', title_2nd: 'কাট', description: 'Haircut' });
    const hidden = await make(db.m, 'Service', { title: 'Secret', is_visible: false });
    const r = await client({ LOCALE_SUPPORTED: 'en,bn' }).get(`/api/v1/public/services/${shown._id}?lang=bn`).expect(200);
    expect(r.body.data).toMatchObject({ title: 'কাট', description: 'Haircut' }); // empty twin falls back
    await client().get(`/api/v1/public/services/${hidden._id}`).expect(404);
    await client().get('/api/v1/public/services/999999').expect(404);
    await client().get('/api/v1/public/services/abc').expect(404);
  });

  it('keeps ids stable and ordered by sort_order then id', async () => {
    const a = await make(db.m, 'Service', { title: 'A', sort_order: 5 });
    const b = await make(db.m, 'Service', { title: 'B', sort_order: 5 });
    const r = await client().get('/api/v1/public/services').expect(200);
    expect(r.body.data.map((s: { id: number }) => s.id)).toEqual([a._id, b._id]);
  });

  it('deleting a service deletes its prices (legacy cascade)', async () => {
    const s = await make(db.m, 'Service', { title: 'S' });
    const other = await make(db.m, 'Service', { title: 'Other' });
    const u = await actingAs(db.m, 'editor', ['pricing.create', 'services.delete']);
    await client().post('/api/v1/pricing').set(u.auth).send({ service_id: s._id, name: 'Basic', price: 10 }).expect(201);
    await client().post('/api/v1/pricing').set(u.auth).send({ service_id: other._id, name: 'Keep', price: 10 }).expect(201);
    await client().delete(`/api/v1/services/${s._id}`).set(u.auth).expect(204);
    expect((await db.m.Pricing.find({}).lean()).map((p) => p.name)).toEqual(['Keep']);
    expect(await dirtyTags()).toEqual(expect.arrayContaining(['services', 'pricings']));
  });
});

describe('pricing', () => {
  const plan = async (service: number, over: Record<string, unknown> = {}) =>
    db.m.Pricing.create({ _id: await nextId(db.m, 'pricings'), service_id: service, name: 'Basic', price: 10, ...over });

  it('requires authentication and pricing.view for the admin list', async () => {
    await client().get('/api/v1/pricing').expect(401);
    await client().get('/api/v1/pricing').set((await actingAs(db.m, 'nobody')).auth).expect(403);
  });

  it('creates, updates and deletes a price for a service', async () => {
    const s = await make(db.m, 'Service', { title: 'S' });
    const u = await actingAs(db.m, 'editor', ['pricing.view', 'pricing.create', 'pricing.update', 'pricing.delete']);
    const created = await client().post('/api/v1/pricing').set(u.auth).send({ service_id: s._id, name: 'Pro', price: 99, features: 'A\nB' }).expect(201);
    expect(created.body.data).toMatchObject({ price: '99.00', service: { id: s._id, title: 'S', title_2nd: null }, is_featured: false });
    const id = created.body.data.id;
    const upd = await client().patch(`/api/v1/pricing/${id}`).set(u.auth).send({ price: 120, is_featured: true }).expect(200);
    expect(upd.body.data.price).toBe('120.00');
    await client().patch(`/api/v1/pricing/${id}`).set(u.auth).send({ price: '12.345' }).expect(200);
    expect((await db.m.Pricing.findById(id).lean())?.price).toBe(12.35);
    await client().post('/api/v1/pricing').set(u.auth).send({ name: 'x' }).expect(422);
    await client().post('/api/v1/pricing').set(u.auth).send({ service_id: 9999, name: 'x', price: 1 }).expect(422);
    await client().post('/api/v1/pricing').set(u.auth).send({ service_id: s._id, name: 'x', price: -1 }).expect(422);
    await client().delete(`/api/v1/pricing/${id}`).set(u.auth).expect(204);
    expect(await dirtyTags()).toContain('pricings');
  });

  it('serves only visible prices of visible services publicly, filterable by service', async () => {
    const a = await make(db.m, 'Service', { title: 'A', sort_order: 1 });
    const b = await make(db.m, 'Service', { title: 'B', sort_order: 2 });
    const hidden = await make(db.m, 'Service', { title: 'Hidden', is_visible: false });
    await plan(b._id, { name: 'B1' });
    await plan(a._id, { name: 'A2', sort_order: 2 });
    await plan(a._id, { name: 'A1', sort_order: 1 });
    await plan(a._id, { name: 'Off', is_visible: false });
    await plan(hidden._id);
    const r = await client().get('/api/v1/public/pricing').expect(200);
    expect(r.body.data.map((p: { name: string }) => p.name)).toEqual(['A1', 'A2', 'B1']);
    const only = await client().get(`/api/v1/public/pricing?service_id=${b._id}`).expect(200);
    expect(only.body.data).toHaveLength(1);
  });

  it('forbids writes without the matching permission', async () => {
    const s = await make(db.m, 'Service', { title: 'S' });
    const p = await plan(s._id);
    const u = await actingAs(db.m, 'viewer', ['pricing.view']);
    await client().post('/api/v1/pricing').set(u.auth).send({ service_id: s._id, name: 'x', price: 1 }).expect(403);
    await client().patch(`/api/v1/pricing/${p._id}`).set(u.auth).send({ price: 1 }).expect(403);
    await client().delete(`/api/v1/pricing/${p._id}`).set(u.auth).expect(403);
  });
});

describe('demo seed', () => {
  it('loads the sample content and is repeatable', async () => {
    await seedDemo(db.m);
    await seedDemo(db.m);
    expect(await db.m.Faq.countDocuments()).toBe(5);
    expect(await db.m.Service.countDocuments()).toBe(6);
    expect(await db.m.Pricing.countDocuments()).toBe(18);
    expect(await db.m.Testimonial.countDocuments()).toBe(3);
    expect(await db.m.TeamMember.countDocuments()).toBe(4);
    expect(await db.m.Section.countDocuments()).toBe(9);
    expect((await db.m.Setting.findById(1).lean())?.site_name).toBe('Northwind Consulting');
    expect((await db.m.Section.findOne({ key: 'pricing' }).lean())?.is_visible).toBe(false);
    const prices = await db.m.Pricing.find({}).sort({ _id: 1 }).limit(3).lean();
    expect(prices.map((p) => p.price)).toEqual([250, 500, 1000]);
    expect(prices[1]?.is_featured).toBe(true);
  });
});

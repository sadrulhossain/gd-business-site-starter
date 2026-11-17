import { inList } from '../../db.ts';
import type { Env } from '../../env.ts';
import { notFoundError } from '../../errors.ts';
import { idParam } from '../../http/helpers.ts';
import type { Api } from '../../http/route.ts';
import { parse, validationError, z } from '../../http/validate.ts';
import { describeImage, removeImage } from '../../media/service.ts';
import { nextId, type Models, type SectionDoc } from '../../models.ts';
import { bilingual } from '../../support/bilingual.ts';
import { localizePublic } from '../../support/localize.ts';
import { replaceImage } from '../settings/routes.ts';

export const sectionResource = (env: Env, s: SectionDoc) => ({
  id: s._id,
  key: s.key,
  title: s.title,
  title_2nd: s.title_2nd ?? null,
  content: s.content ?? null,
  content_2nd: s.content_2nd ?? null,
  image: describeImage(env, s.image),
  sort_order: s.sort_order,
  is_visible: s.is_visible,
  updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : null,
});

/** Sections that exist from the first seed, in display order: [key, title, visible]. */
export const DEFAULT_SECTIONS: [string, string, boolean][] = [
  ['hero', 'Welcome', true], ['about', 'About us', true], ['services', 'Our services', true], ['pricing', 'Pricing', false],
  ['contact', 'Contact us', true], ['testimonials', 'Testimonials', false], ['gallery', 'Gallery', false],
  ['faq', 'Frequently asked questions', false], ['team', 'Our team', false],
];

const copy = bilingual({ title: { max: 150, required: true }, content: { max: 10000 } });
export const updateSectionSchema = z.strictObject({ ...copy, sort_order: z.number().int().min(0).max(65535).optional(), is_visible: z.boolean().optional() });
export const sectionPanelSchema = z.strictObject(copy);
export const reorderSectionsSchema = z.strictObject({ ids: z.array(z.number().int().positive()).min(1).max(500) });

/** Hero and About panels: the section row is created on first use if the seed has not run. */
export async function panel(m: Models, key: string): Promise<SectionDoc> {
  const found = await m.Section.findOne({ key }).lean();
  if (found) return found;
  const created = await m.Section.create({
    _id: await nextId(m, 'sections'), key, title: key === 'hero' ? 'Welcome' : key === 'about' ? 'About us' : key[0]!.toUpperCase() + key.slice(1),
    sort_order: key === 'hero' ? 10 : 20, is_visible: true,
  });
  return created.toObject();
}

export function sectionRoutes(api: Api, env: Env): void {
  api.get('/public/sections', { public: true }, localizePublic(env), async (_req, res) => {
    const rows = await res.locals.models().Section.find({ is_visible: true }).sort({ sort_order: 1, _id: 1 }).lean();
    res.json({ data: rows.map((s) => sectionResource(env, s)) });
  });

  api.get('/sections', { permission: 'sections.view' }, async (_req, res) => {
    const rows = await res.locals.models().Section.find({}).sort({ sort_order: 1, _id: 1 }).lean();
    res.json({ data: rows.map((s) => sectionResource(env, s)) });
  });

  // Registered before /sections/:id so "reorder" is never read as an id.
  api.put('/sections/reorder', { permission: 'sections.update' }, async (req, res) => {
    const { ids } = parse(reorderSectionsSchema, req.body);
    if (new Set(ids).size !== ids.length) throw validationError({ ids: ['Entries must be distinct.'] });
    const { Section } = res.locals.models();
    const known = new Set((await Section.find({ _id: inList(ids) }, { _id: 1 }).lean()).map((s) => s._id));
    const missing = ids.findIndex((id) => !known.has(id));
    if (missing >= 0) throw validationError({ [`ids.${missing}`]: ['The selected section is invalid.'] });
    await Section.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { sort_order: (i + 1) * 10 } } } })));
    res.json({ data: { reordered: ids.length } });
  });

  api.get('/sections/:id', { permission: 'sections.view' }, async (req, res) => {
    const s = await res.locals.models().Section.findOne({ _id: idParam(req) }).lean();
    if (!s) throw notFoundError();
    res.json({ data: sectionResource(env, s) });
  });

  const update: Parameters<Api['patch']>[2] = async (req, res) => {
    const id = idParam(req);
    const body = parse(updateSectionSchema, req.body);
    const s = await res.locals.models().Section.findOneAndUpdate({ _id: id }, { $set: body }, { returnDocument: 'after' }).lean();
    if (!s) throw notFoundError();
    res.json({ data: sectionResource(env, s) });
  };
  api.patch('/sections/:id', { permission: 'sections.update' }, update);
  api.put('/sections/:id', { permission: 'sections.update' }, update);

  api.post('/sections/:id/image', { permission: 'sections.update' }, async (req, res) => {
    const m = res.locals.models();
    const id = idParam(req);
    const section = await m.Section.findOne({ _id: id }).lean();
    if (!section) throw notFoundError();
    await replaceImage(env, req, res, { dir: 'sections', slot: 'image', current: section.image, save: async (image) => void (await m.Section.updateOne({ _id: id }, { $set: { image } })) });
    res.json({ data: sectionResource(env, (await m.Section.findOne({ _id: id }).lean())!) });
  });

  api.delete('/sections/:id/image', { permission: 'sections.update' }, async (req, res) => {
    const m = res.locals.models();
    const id = idParam(req);
    const section = await m.Section.findOne({ _id: id }).lean();
    if (!section) throw notFoundError();
    await m.Section.updateOne({ _id: id }, { $set: { image: null } });
    removeImage(env, section.image);
    res.json({ data: sectionResource(env, (await m.Section.findOne({ _id: id }).lean())!) });
  });

  // Single-section screens (hero, about): permissions <key>.view / <key>.update.
  for (const key of ['hero', 'about'] as const) {
    api.get(`/${key}`, { permission: `${key}.view` }, async (_req, res) => {
      res.json({ data: sectionResource(env, await panel(res.locals.models(), key)) });
    });

    api.patch(`/${key}`, { permission: `${key}.update` }, async (req, res) => {
      const body = parse(sectionPanelSchema, req.body);
      const m = res.locals.models();
      await panel(m, key);
      res.json({ data: sectionResource(env, (await m.Section.findOneAndUpdate({ key }, { $set: body }, { returnDocument: 'after' }).lean())!) });
    });

    api.post(`/${key}/image`, { permission: `${key}.update` }, async (req, res) => {
      const m = res.locals.models();
      const section = await panel(m, key);
      await replaceImage(env, req, res, { dir: 'sections', slot: 'image', current: section.image, save: async (image) => void (await m.Section.updateOne({ key }, { $set: { image } })) });
      res.json({ data: sectionResource(env, (await panel(m, key))) });
    });

    api.delete(`/${key}/image`, { permission: `${key}.update` }, async (_req, res) => {
      const m = res.locals.models();
      const section = await panel(m, key);
      await m.Section.updateOne({ key }, { $set: { image: null } });
      removeImage(env, section.image);
      res.json({ data: sectionResource(env, await panel(m, key)) });
    });
  }
}

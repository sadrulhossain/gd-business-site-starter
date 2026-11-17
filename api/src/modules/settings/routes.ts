import type { Request, Response } from 'express';
import { uploadsMaxBytes, type Env } from '../../env.ts';
import type { Api } from '../../http/route.ts';
import { parse, z } from '../../http/validate.ts';
import { FAVICON_MAX_BYTES, describeImage, removeImage, storeImage } from '../../media/service.ts';
import { readForm } from '../../media/multipart.ts';
import type { MediaImage, Models, SettingDoc } from '../../models.ts';
import { bilingual, optionalText } from '../../support/bilingual.ts';
import { localizePublic } from '../../support/localize.ts';


export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const SOCIAL = ['facebook', 'instagram', 'x', 'linkedin', 'youtube', 'tiktok', 'whatsapp'] as const;

const OPEN = { open: '09:00', close: '17:00', closed: false };
const CLOSED = { open: null, close: null, closed: true };

export const settingDefaults = () => ({
  site_name: 'My Business',
  tagline: 'Welcome',
  currency: 'USD',
  currency_symbol: '$',
  hours: Object.fromEntries(DAYS.map((d, i) => [d, i < 5 ? OPEN : CLOSED])),
  social_links: {},
});

/** The singleton row (_id 1), created with the defaults on first use; an existing row is never overwritten. */
export async function currentSetting(m: Models): Promise<SettingDoc> {
  const doc = await m.Setting.findOneAndUpdate({ _id: 1 }, { $setOnInsert: settingDefaults() }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
  return doc!;
}

export const settingResource = (env: Env, s: SettingDoc) => ({
  site_name: s.site_name,
  site_name_2nd: s.site_name_2nd ?? null,
  tagline: s.tagline ?? null,
  tagline_2nd: s.tagline_2nd ?? null,
  currency: s.currency ?? null,
  currency_symbol: s.currency_symbol ?? null,
  logo: describeImage(env, s.logo),
  favicon: describeImage(env, s.favicon),
  address: s.address ?? null,
  address_2nd: s.address_2nd ?? null,
  phone: s.phone ?? null,
  email: s.email ?? null,
  hours: s.hours ?? null,
  social_links: s.social_links ?? {},
  updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : null,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the HH:MM format.');
const day = z.strictObject({ open: hhmm.nullable().optional(), close: hhmm.nullable().optional(), closed: z.boolean() });

const updateSchema = z.strictObject({
  ...bilingual({ site_name: { max: 120, required: true }, tagline: { max: 255 }, address: { max: 500 } }),
  currency: optionalText(10),
  currency_symbol: optionalText(10),
  phone: optionalText(40),
  email: z.string().max(255).pipe(z.email()).nullable().optional(),
  hours: z.strictObject(Object.fromEntries(DAYS.map((d) => [d, day.optional()]))).nullable().optional(),
  social_links: z.strictObject(Object.fromEntries(SOCIAL.map((k) => [k, z.url().max(255).nullable().optional()]))).nullable().optional(),
});

const BODY_OVERHEAD = 256 * 1024;
export const imageBodyLimit = (env: Env, slot: 'image' | 'favicon') => (slot === 'favicon' ? FAVICON_MAX_BYTES + BODY_OVERHEAD : uploadsMaxBytes(env) * 3 + BODY_OVERHEAD);

/** Shared by every image endpoint: read the multipart body, commit the new files, save, then remove the old files. */
export async function replaceImage(
  env: Env, req: Request, res: Response,
  opts: { dir: string; slot: 'image' | 'favicon'; current: MediaImage | null; save: (image: MediaImage | null) => Promise<void> },
): Promise<void> {
  const m = res.locals.models();
  const form = await readForm(req, imageBodyLimit(env, opts.slot));
  const image = await storeImage(env, m, form, { dir: opts.dir, slot: opts.slot, replacing: opts.current });
  await opts.save(image);
  removeImage(env, opts.current);
}

export function settingRoutes(api: Api, env: Env): void {
  api.get('/public/settings', { public: true }, localizePublic(env), async (_req, res) => {
    res.json({ data: settingResource(env, await currentSetting(res.locals.models())) });
  });

  api.get('/settings', { permission: 'settings.view' }, async (_req, res) => {
    res.json({ data: settingResource(env, await currentSetting(res.locals.models())) });
  });

  const update: Parameters<Api['patch']>[2] = async (req, res) => {
    const body = parse(updateSchema, req.body);
    const m = res.locals.models();
    await currentSetting(m);
    const fresh = await m.Setting.findOneAndUpdate({ _id: 1 }, { $set: body }, { returnDocument: 'after' }).lean();
    res.json({ data: settingResource(env, fresh!) });
  };
  api.patch('/settings', { permission: 'settings.update' }, update);
  api.put('/settings', { permission: 'settings.update' }, update);

  for (const slot of ['logo', 'favicon'] as const) {
    api.post(`/settings/${slot}`, { permission: 'settings.update' }, async (req, res) => {
      const m = res.locals.models();
      const current = (await currentSetting(m))[slot];
      await replaceImage(env, req, res, {
        dir: 'site',
        slot: slot === 'favicon' ? 'favicon' : 'image',
        current,
        save: async (image) => void (await m.Setting.updateOne({ _id: 1 }, { $set: { [slot]: image } })),
      });
      res.json({ data: settingResource(env, (await currentSetting(m))) });
    });

    api.delete(`/settings/${slot}`, { permission: 'settings.update' }, async (_req, res) => {
      const m = res.locals.models();
      const current = (await currentSetting(m))[slot];
      await m.Setting.updateOne({ _id: 1 }, { $set: { [slot]: null } });
      removeImage(env, current);
      res.json({ data: settingResource(env, await currentSetting(m)) });
    });
  }
}

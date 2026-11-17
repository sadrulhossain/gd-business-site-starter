import type { Request } from 'express';
import type { Model } from 'mongoose';
import type { Env } from '../env.ts';
import { notFoundError } from '../errors.ts';
import { idParam, iso } from '../http/helpers.ts';
import type { Api } from '../http/route.ts';
import { parse, z } from '../http/validate.ts';
import { replaceImage } from '../modules/settings/routes.ts';
import { removeImage } from '../media/service.ts';
import { nextId, type MediaImage, type Models } from '../models.ts';
import { localizePublic } from './localize.ts';

/** Fields every ordered, show/hide content row has. */
export interface Row { _id: number; sort_order: number; is_visible: boolean; updated_at: Date; image?: MediaImage | null }

/** sort_order and is_visible, as in every legacy form request (sort_order 0-65535). */
export const orderFields = {
  sort_order: z.number().int().min(0).max(65535).optional(),
  is_visible: z.boolean().optional(),
};

export const stamp = (d: { updated_at: Date }): string | null => iso(d.updated_at);

export interface ContentModule<D extends Row, X = undefined> {
  /** URL segment and permission module, e.g. 'faqs'. */
  path: string;
  model: keyof Models;
  create: z.ZodType;
  update: z.ZodType;
  resource: (env: Env, d: D, extra: X) => object;
  /** Image endpoints use this folder under media/. Omit for modules without an image. */
  imageDir?: string;
  /** Public list segment (/public/<publicPath>); default = path. */
  publicPath?: string;
  /** Also serve GET /public/<publicPath>/:id (visible rows only). */
  publicShow?: boolean;
  /** Related data for a batch of rows (pricing: its services). */
  prepare?: (m: Models, rows: D[]) => Promise<X>;
  /** Replaces the default list queries (pricing joins its service). */
  list?: (m: Models, req: Request, opts: { public: boolean }) => Promise<D[]>;
  /** Runs before create/update is written; throw validationError to refuse. */
  check?: (m: Models, body: Record<string, unknown>) => Promise<void>;
  /** Runs after the row is deleted (pricing is removed with its service). */
  afterDelete?: (m: Models, row: D) => Promise<void>;
  /** Maps the validated body before it is stored (pricing rounds its price). */
  map?: (body: Record<string, unknown>) => Record<string, unknown>;
}

const sorted = { sort_order: 1, _id: 1 } as const;

/**
 * Registers the six legacy routes of a content module plus its public reads and image endpoints:
 *   GET/POST /<path>, GET/PATCH/PUT/DELETE /<path>/:id, POST/DELETE /<path>/:id/image,
 *   GET /public/<path> [and /public/<path>/:id].
 * Every write goes through a model carrying markDirtyPlugin, so tags are recorded automatically.
 */
export function contentRoutes<D extends Row, X = undefined>(api: Api, env: Env, c: ContentModule<D, X>): void {
  const model = (m: Models) => m[c.model] as unknown as Model<D>;
  const find = async (m: Models, req: Request, isPublic: boolean): Promise<D[]> =>
    c.list ? c.list(m, req, { public: isPublic }) : ((await model(m).find(isPublic ? { is_visible: true } : {}).sort(sorted).lean()) as unknown as D[]);
  const present = async (m: Models, rows: D[]): Promise<object[]> => {
    const extra = (c.prepare ? await c.prepare(m, rows) : undefined) as X;
    return rows.map((r) => c.resource(env, r, extra));
  };
  const one = async (m: Models, id: number): Promise<D> => {
    const row = (await model(m).findOne({ _id: id }).lean()) as unknown as D | null;
    if (!row) throw notFoundError();
    return row;
  };
  const publicPath = c.publicPath ?? c.path;

  api.get(`/public/${publicPath}`, { public: true }, localizePublic(env), async (req, res) => {
    const m = res.locals.models();
    res.json({ data: await present(m, await find(m, req, true)) });
  });
  if (c.publicShow) {
    api.get(`/public/${publicPath}/:id`, { public: true }, localizePublic(env), async (req, res) => {
      const m = res.locals.models();
      const row = await one(m, idParam(req));
      if (!row.is_visible) throw notFoundError();
      res.json({ data: (await present(m, [row]))[0] });
    });
  }

  api.get(`/${c.path}`, { permission: `${c.path}.view` }, async (req, res) => {
    const m = res.locals.models();
    res.json({ data: await present(m, await find(m, req, false)) });
  });

  api.post(`/${c.path}`, { permission: `${c.path}.create` }, async (req, res) => {
    const m = res.locals.models();
    let body = parse(c.create, req.body) as Record<string, unknown>;
    await c.check?.(m, body);
    if (c.map) body = c.map(body);
    const created = await model(m).create({ ...body, _id: await nextId(m, String(c.model) === 'Pricing' ? 'pricings' : model(m).collection.name) } as never);
    res.status(201).json({ data: (await present(m, [await one(m, (created as unknown as Row)._id)]))[0] });
  });

  api.get(`/${c.path}/:id`, { permission: `${c.path}.view` }, async (req, res) => {
    const m = res.locals.models();
    res.json({ data: (await present(m, [await one(m, idParam(req))]))[0] });
  });

  const update: Parameters<Api['patch']>[2] = async (req, res) => {
    const m = res.locals.models();
    const id = idParam(req);
    let body = parse(c.update, req.body) as Record<string, unknown>;
    await one(m, id);
    await c.check?.(m, body);
    if (c.map) body = c.map(body);
    await model(m).updateOne({ _id: id }, { $set: body } as never);
    res.json({ data: (await present(m, [await one(m, id)]))[0] });
  };
  api.patch(`/${c.path}/:id`, { permission: `${c.path}.update` }, update);
  api.put(`/${c.path}/:id`, { permission: `${c.path}.update` }, update);

  api.delete(`/${c.path}/:id`, { permission: `${c.path}.delete` }, async (req, res) => {
    const m = res.locals.models();
    const row = await one(m, idParam(req));
    await model(m).deleteOne({ _id: row._id });
    await c.afterDelete?.(m, row);
    removeImage(env, row.image);
    res.status(204).end();
  });

  if (c.imageDir) {
    const dir = c.imageDir;
    api.post(`/${c.path}/:id/image`, { permission: `${c.path}.update` }, async (req, res) => {
      const m = res.locals.models();
      const id = idParam(req);
      const row = await one(m, id);
      await replaceImage(env, req, res, { dir, slot: 'image', current: row.image ?? null, save: async (image) => void (await model(m).updateOne({ _id: id }, { $set: { image } } as never)) });
      res.json({ data: (await present(m, [await one(m, id)]))[0] });
    });

    api.delete(`/${c.path}/:id/image`, { permission: `${c.path}.update` }, async (req, res) => {
      const m = res.locals.models();
      const id = idParam(req);
      const row = await one(m, id);
      await model(m).updateOne({ _id: id }, { $set: { image: null } } as never);
      removeImage(env, row.image);
      res.json({ data: (await present(m, [await one(m, id)]))[0] });
    });
  }
}

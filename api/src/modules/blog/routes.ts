import type { Request } from 'express';
import { inList, notEq, upTo } from '../../db.ts';
import type { Env } from '../../env.ts';
import { HttpError, notFoundError } from '../../errors.ts';
import { idParam, paginate } from '../../http/helpers.ts';
import type { Api } from '../../http/route.ts';
import { parse, validationError, z } from '../../http/validate.ts';
import { removeImage } from '../../media/service.ts';
import { nextId, type CategoryDoc, type Models, type PostDoc } from '../../models.ts';
import { localizePublic } from '../../support/localize.ts';
import { replaceImage } from '../settings/routes.ts';
import { categoryResource, createCategory, createPost, postResource, resolveStatus, slugify, updateCategory, updatePost } from './schema.ts';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  category: z.string().max(120).optional(),
  lang: z.string().optional(),
});

/** Runs the zod schema and the database checks together so one 422 lists every field (legacy FormRequest behaviour). */
async function validate<S extends z.ZodType>(m: Models, schema: S, body: unknown, ignore: { category?: number; post?: number } = {}, kind: 'category' | 'post'): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let details: Record<string, string[]> = {};
  let data: unknown;
  try {
    data = parse(schema, body);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 422) throw e;
    details = { ...(e.details as Record<string, string[]>) };
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  if (typeof raw.slug === 'string' && !details.slug) {
    const taken = kind === 'post'
      ? await m.Post.exists({ slug: raw.slug, ...(ignore.post ? { _id: notEq(ignore.post) } : {}) } as never)
      : await m.Category.exists({ slug: raw.slug, ...(ignore.category ? { _id: notEq(ignore.category) } : {}) } as never);
    if (taken) details.slug = ['The slug has already been taken.'];
  }
  if (kind === 'post' && Number.isInteger(raw.category_id) && !details.category_id && !(await m.Category.exists({ _id: raw.category_id as number }))) {
    details.category_id = ['The selected category id is invalid.'];
  }
  if (Object.keys(details).length) throw validationError(details);
  return data;
}

/** Slug free in posts: base, base-2, base-3, ... */
async function freeSlug(m: Models, base: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await m.Post.exists({ slug: candidate }))) return candidate;
  }
  throw new HttpError(409, 'conflict', 'Could not generate a unique slug.');
}

const categoriesFor = async (m: Models, rows: PostDoc[]): Promise<Map<number, CategoryDoc>> => {
  const ids = [...new Set(rows.map((r) => r.category_id).filter((x): x is number => x !== null))];
  return new Map((await m.Category.find({ _id: inList(ids) }).lean()).map((c) => [c._id, c]));
};
const presentPosts = async (env: Env, m: Models, rows: PostDoc[]) => {
  const cats = await categoriesFor(m, rows);
  return rows.map((p) => postResource(env, p, p.category_id === null ? null : cats.get(p.category_id)));
};

export function categoryRoutes(api: Api): void {
  const sorted = { sort_order: 1, _id: 1 } as const;
  const one = async (m: Models, id: number) => {
    const c = await m.Category.findOne({ _id: id }).lean();
    if (!c) throw notFoundError();
    return c;
  };

  api.get('/public/categories', { public: true }, async (_req, res) => {
    res.json({ data: (await res.locals.models().Category.find({}).sort(sorted).lean()).map(categoryResource) });
  });
  api.get('/categories', { permission: 'categories.view' }, async (_req, res) => {
    res.json({ data: (await res.locals.models().Category.find({}).sort(sorted).lean()).map(categoryResource) });
  });
  api.post('/categories', { permission: 'categories.create' }, async (req, res) => {
    const m = res.locals.models();
    const body = await validate(m, createCategory, req.body, {}, 'category');
    const c = await m.Category.create({ ...body, _id: await nextId(m, 'categories') });
    res.status(201).json({ data: categoryResource(c.toObject()) });
  });
  api.get('/categories/:id', { permission: 'categories.view' }, async (req, res) => {
    res.json({ data: categoryResource(await one(res.locals.models(), idParam(req))) });
  });
  const update: Parameters<Api['patch']>[2] = async (req, res) => {
    const m = res.locals.models();
    const id = idParam(req);
    await one(m, id);
    const body = await validate(m, updateCategory, req.body, { category: id }, 'category');
    await m.Category.updateOne({ _id: id }, { $set: body });
    res.json({ data: categoryResource(await one(m, id)) });
  };
  api.patch('/categories/:id', { permission: 'categories.update' }, update);
  api.put('/categories/:id', { permission: 'categories.update' }, update);
  api.delete('/categories/:id', { permission: 'categories.delete' }, async (req, res) => {
    const m = res.locals.models();
    const id = idParam(req);
    await one(m, id);
    await m.Category.deleteOne({ _id: id });
    await m.Post.updateMany({ category_id: id }, { $set: { category_id: null } }); // legacy: ON DELETE SET NULL
    res.status(204).end();
  });
}

export function postRoutes(api: Api, env: Env): void {
  /** Published and not scheduled for later (legacy Post::published scope). */
  const published = () => ({ is_published: true, $or: [{ published_at: null }, { published_at: upTo(new Date()) }] });
  const newestFirst = { published_at: -1, _id: -1 } as const;
  const one = async (m: Models, id: number) => {
    const p = await m.Post.findOne({ _id: id }).lean();
    if (!p) throw notFoundError();
    return p;
  };
  const show = async (m: Models, id: number) => (await presentPosts(env, m, [await one(m, id)]))[0];

  api.get('/public/posts', { public: true }, localizePublic(env), async (req: Request, res) => {
    const { page, category } = parse(pageQuery, req.query);
    const m = res.locals.models();
    let filter: Record<string, unknown> = published();
    if (category) {
      const c = await m.Category.findOne({ slug: category }, { _id: 1 }).lean();
      filter = { ...filter, category_id: c ? c._id : -1 };
    }
    res.json(await paginate(m.Post, `${req.baseUrl}${req.path}`, page, 12, (rows) => presentPosts(env, m, rows), newestFirst, filter));
  });
  api.get('/public/posts/:slug', { public: true }, localizePublic(env), async (req, res) => {
    const m = res.locals.models();
    const p = await m.Post.findOne({ slug: String(req.params.slug), ...published() }).lean();
    if (!p) throw notFoundError();
    res.json({ data: (await presentPosts(env, m, [p]))[0] });
  });

  api.get('/posts', { permission: 'posts.view' }, async (req, res) => {
    const { page } = parse(pageQuery, req.query);
    const m = res.locals.models();
    res.json(await paginate(m.Post, `${req.baseUrl}${req.path}`, page, 20, (rows) => presentPosts(env, m, rows), { _id: -1 }));
  });
  api.get('/posts/:id', { permission: 'posts.view' }, async (req, res) => {
    const m = res.locals.models();
    res.json({ data: await show(m, idParam(req)) });
  });

  api.post('/posts', { permission: 'posts.create' }, async (req, res) => {
    const m = res.locals.models();
    const body = resolveStatus(await validate(m, createPost, req.body, {}, 'post'));
    const slug = body.slug ?? (await freeSlug(m, slugify(body.title)));
    const created = await m.Post.create({ ...body, slug, _id: await nextId(m, 'posts') });
    res.status(201).json({ data: await show(m, created._id) });
  });

  const update: Parameters<Api['patch']>[2] = async (req, res) => {
    const m = res.locals.models();
    const id = idParam(req);
    const current = await one(m, id);
    const body = resolveStatus(await validate(m, updatePost, req.body, { post: id }, 'post'));
    // A published post keeps its URL: changing the slug would break links and the portal page.
    if (current.is_published && body.slug !== undefined && body.slug !== current.slug) {
      throw validationError({ slug: ['The slug cannot be changed once the post is published.'] });
    }
    await m.Post.updateOne({ _id: id }, { $set: body });
    res.json({ data: await show(m, id) });
  };
  api.patch('/posts/:id', { permission: 'posts.update' }, update);
  api.put('/posts/:id', { permission: 'posts.update' }, update);

  api.delete('/posts/:id', { permission: 'posts.delete' }, async (req, res) => {
    const m = res.locals.models();
    const p = await one(m, idParam(req));
    await m.Post.deleteOne({ _id: p._id });
    removeImage(env, p.image);
    res.status(204).end();
  });

  api.post('/posts/:id/image', { permission: 'posts.update' }, async (req, res) => {
    const m = res.locals.models();
    const id = idParam(req);
    const p = await one(m, id);
    await replaceImage(env, req, res, { dir: 'posts', slot: 'image', current: p.image, save: async (image) => void (await m.Post.updateOne({ _id: id }, { $set: { image } })) });
    res.json({ data: await show(m, id) });
  });
  api.delete('/posts/:id/image', { permission: 'posts.update' }, async (req, res) => {
    const m = res.locals.models();
    const id = idParam(req);
    const p = await one(m, id);
    await m.Post.updateOne({ _id: id }, { $set: { image: null } });
    removeImage(env, p.image);
    res.json({ data: await show(m, id) });
  });
}

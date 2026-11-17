import { z } from '../../http/validate.ts';
import type { Env } from '../../env.ts';
import { iso } from '../../http/helpers.ts';
import { describeImage } from '../../media/service.ts';
import type { CategoryDoc, PostDoc } from '../../models.ts';
import { bilingual } from '../../support/bilingual.ts';
import { orderFields } from '../../support/content.ts';
import { cleanHtml } from '../../support/sanitize.ts';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slug = (max: number) => z.string().max(max).regex(SLUG, 'The slug may only contain lowercase letters, numbers and single hyphens.');

// ---- categories
const categoryText = { name: { max: 100, required: true } } as const;
export const createCategory = z.strictObject({ ...bilingual(categoryText, { partial: false }), slug: slug(120), sort_order: orderFields.sort_order });
export const updateCategory = z.strictObject({ ...bilingual(categoryText), slug: slug(120).optional(), sort_order: orderFields.sort_order });

export const categoryResource = (c: CategoryDoc) => ({
  id: c._id, name: c.name, name_2nd: c.name_2nd ?? null, slug: c.slug, sort_order: c.sort_order, updated_at: iso(c.updated_at),
});

// ---- posts
const postText = {
  title: { max: 255, required: true }, excerpt: { max: 1000 }, seo_title: { max: 70 }, seo_description: { max: 320 },
} as const;
/** Rich text: sanitised on write; blank becomes null. */
const html = z.string().max(200000).nullable().optional().transform((v) => (v === undefined ? undefined : cleanHtml(v)));
const date = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'The published at is not a valid date.')
  .transform((v) => new Date(v))
  .nullable()
  .optional();

const postShared = {
  body: html, body_2nd: html,
  category_id: z.number().int().nullable().optional(),
  is_published: z.boolean().optional(),
  status: z.enum(['draft', 'published']).optional(),
  published_at: date,
};

/** `status` is a synonym of is_published and wins when both are sent (legacy ResolvesPostStatus). */
export const resolveStatus = <T extends { status?: 'draft' | 'published'; is_published?: boolean }>(body: T): Omit<T, 'status'> => {
  const { status, ...rest } = body;
  return status === undefined ? rest : { ...rest, is_published: status === 'published' };
};

// slug is optional on create: it is generated from the title when omitted.
export const createPost = z.strictObject({ ...bilingual(postText, { partial: false }), slug: slug(150).optional(), ...postShared });
export const updatePost = z.strictObject({ ...bilingual(postText), slug: slug(150).optional(), ...postShared });

export const postResource = (env: Env, p: PostDoc, category: CategoryDoc | null | undefined) => ({
  id: p._id, category_id: p.category_id ?? null, category: category ? categoryResource(category) : null,
  title: p.title, title_2nd: p.title_2nd ?? null, slug: p.slug,
  excerpt: p.excerpt ?? null, excerpt_2nd: p.excerpt_2nd ?? null, body: p.body ?? null, body_2nd: p.body_2nd ?? null,
  seo_title: p.seo_title ?? null, seo_title_2nd: p.seo_title_2nd ?? null, seo_description: p.seo_description ?? null, seo_description_2nd: p.seo_description_2nd ?? null,
  image: describeImage(env, p.image),
  is_published: p.is_published, status: p.is_published ? 'published' : 'draft',
  published_at: iso(p.published_at), updated_at: iso(p.updated_at),
});

/** Lowercase ASCII slug from a title; falls back to "post" when nothing usable is left (e.g. non-Latin titles). */
export const slugify = (title: string): string =>
  title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || 'post';

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Must run before any schema is built (ADR 014).
extendZodWithOpenApi(z);

/**
 * Response shapes, one per resource function. They document the API and are checked against real responses in
 * test/openapi.test.ts, so a resource that drifts from its schema fails a test. Keys are always present (nullable
 * when empty), as in the legacy resources.
 */
const int = z.number().int();
const str = z.string();
const nstr = z.string().nullable();
const date = z.string().datetime().nullable();
const image = z
  .object({ url: str, webp: z.record(z.string(), str), width: int.nullable(), height: int.nullable(), committed_at: nstr })
  .nullable();

const order = { sort_order: int, is_visible: z.boolean(), updated_at: date };

export const CategoryResource = z.object({ id: int, name: str, name_2nd: nstr, slug: str, sort_order: int, updated_at: date }).openapi('CategoryResource');
export const FaqResource = z.object({ id: int, question: str, question_2nd: nstr, answer: str, answer_2nd: nstr, ...order }).openapi('FaqResource');
export const ServiceResource = z.object({ id: int, title: str, title_2nd: nstr, description: nstr, description_2nd: nstr, image, ...order }).openapi('ServiceResource');
export const PricingResource = z
  .object({
    id: int, service_id: int, service: z.object({ id: int, title: str, title_2nd: nstr }).nullable(),
    name: str, name_2nd: nstr, price: str, unit: nstr, unit_2nd: nstr, description: nstr, description_2nd: nstr,
    features: nstr, features_2nd: nstr, is_featured: z.boolean(), ...order,
  })
  .openapi('PricingResource');
export const TestimonialResource = z
  .object({ id: int, author_name: str, author_role: nstr, author_role_2nd: nstr, quote: str, quote_2nd: nstr, image, ...order })
  .openapi('TestimonialResource');
export const TeamMemberResource = z.object({ id: int, name: str, role: str, role_2nd: nstr, bio: nstr, bio_2nd: nstr, image, ...order }).openapi('TeamMemberResource');
export const GalleryItemResource = z.object({ id: int, title: nstr, title_2nd: nstr, caption: nstr, caption_2nd: nstr, image, ...order }).openapi('GalleryItemResource');
export const SectionResource = z
  .object({ id: int, key: str, title: str, title_2nd: nstr, content: nstr, content_2nd: nstr, image, ...order })
  .openapi('SectionResource');
export const SettingResource = z
  .object({
    site_name: str, site_name_2nd: nstr, tagline: nstr, tagline_2nd: nstr, currency: nstr, currency_symbol: nstr, logo: image, favicon: image,
    address: nstr, address_2nd: nstr, phone: nstr, email: nstr,
    hours: z.record(z.string(), z.object({ open: nstr, close: nstr, closed: z.boolean() })).nullable(),
    social_links: z.record(z.string(), nstr), updated_at: date,
  })
  .openapi('SettingResource');
export const PostResource = z
  .object({
    id: int, category_id: int.nullable(), category: CategoryResource.nullable(),
    title: str, title_2nd: nstr, slug: str, excerpt: nstr, excerpt_2nd: nstr, body: nstr, body_2nd: nstr,
    seo_title: nstr, seo_title_2nd: nstr, seo_description: nstr, seo_description_2nd: nstr,
    image, is_published: z.boolean(), status: z.enum(['published', 'draft']), published_at: date, updated_at: date,
  })
  .openapi('PostResource');
export const ContactMessageResource = z
  .object({ id: int, name: str, email: str, phone: nstr, subject: nstr, message: str, read_at: date, created_at: date })
  .openapi('ContactMessageResource');
export const UserResource = z.object({ id: int, name: str, email: str, roles: z.array(str), is_superadmin: z.boolean(), created_at: date }).openapi('UserResource');
export const RoleResource = z.object({ id: int, name: str, permissions: z.array(str) }).openapi('RoleResource');
export const MenuResource = z
  .object({ id: int, parent_id: int.nullable(), depth: int, title: str, icon: nstr, path: nstr, permission_name: nstr, sort: int })
  .openapi('MenuResource');
// children hold the same shape; the schema stays flat because the generator cannot walk a recursive type.
export const MenuNode = z.object({ id: int, title: str, icon: nstr, path: nstr, permission_name: nstr, children: z.array(z.record(z.string(), z.unknown())) });
export const MeResource = z
  .object({ id: int, name: str, email: str, is_superadmin: z.boolean(), roles: z.array(str), permissions: z.array(str) })
  .openapi('MeResource');

export const Captcha = z.object({ id: str, question: str }).openapi('Captcha');
export const Received = z.object({ received: z.literal(true) });
export const Reordered = z.object({ reordered: int });
export const Locales = z.object({ default: str, fallback: str, supported: z.array(str) });
export const SiteStatus = z.object({ dirty: z.boolean(), last_dispatched_at: date });
export const Published = z.object({ dispatched: z.literal(true), last_dispatched_at: date });
export const Counts = z.record(z.string(), int);
export const TokenResponse = z.object({ access_token: str, token_type: z.literal('Bearer'), expires_in: int });

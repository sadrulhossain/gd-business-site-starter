import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { RouteMeta } from '../http/route.ts';
import { loginSchema } from '../modules/auth/schema.ts';
import { createCategory, createPost, updateCategory, updatePost } from '../modules/blog/schema.ts';
import { contactSchema } from '../modules/contact/routes.ts';
import { createFaq, updateFaq } from '../modules/faqs/schema.ts';
import { createGalleryItem, updateGalleryItem } from '../modules/gallery/schema.ts';
import { reorderSchema, updateMenuSchema } from '../modules/menus/schema.ts';
import { updateProfileSchema } from '../modules/me/routes.ts';
import { createPricing, updatePricing } from '../modules/pricing/schema.ts';
import { storeRoleSchema, updateRoleSchema } from '../modules/roles/routes.ts';
import { createService, updateService } from '../modules/services/schema.ts';
import { createTeamMember, updateTeamMember } from '../modules/team/schema.ts';
import { createTestimonial, updateTestimonial } from '../modules/testimonials/schema.ts';
import { storeUserSchema, updateUserSchema } from '../modules/users/schema.ts';
import {
  CategoryResource, ContactMessageResource, Captcha, Counts, FaqResource, GalleryItemResource, Locales, MenuResource, MeResource, PostResource,
  PricingResource, Published, Received, Reordered, RoleResource, SectionResource, ServiceResource, SettingResource, SiteStatus, TeamMemberResource,
  TestimonialResource, TokenResponse, UserResource, MenuNode,
} from './responses.ts';
import { reorderSectionsSchema, updateSectionSchema, sectionPanelSchema } from '../modules/sections/routes.ts';
import { updateSettingSchema } from '../modules/settings/routes.ts';


type Schema = z.ZodType;

const resources: Record<string, Schema> = {
  faqs: FaqResource, services: ServiceResource, pricing: PricingResource, testimonials: TestimonialResource, team: TeamMemberResource,
  gallery: GalleryItemResource, sections: SectionResource, hero: SectionResource, about: SectionResource, settings: SettingResource,
  categories: CategoryResource, posts: PostResource, 'contact-messages': ContactMessageResource, users: UserResource, roles: RoleResource,
  menus: MenuResource, me: MeResource,
};
const paginated = new Set(['/posts', '/public/posts', '/users', '/contact-messages']);

/** Write bodies by "METHOD /registered/path". PUT and PATCH share the update schema. */
const bodies: Record<string, Schema> = {};
const bodyFor = (base: string, create: Schema | null, update: Schema | null): void => {
  if (create) bodies[`POST ${base}`] = create;
  if (update) {
    bodies[`PATCH ${base}/:id`] = update;
    bodies[`PUT ${base}/:id`] = update;
  }
};
bodyFor('/faqs', createFaq, updateFaq);
bodyFor('/services', createService, updateService);
bodyFor('/pricing', createPricing, updatePricing);
bodyFor('/testimonials', createTestimonial, updateTestimonial);
bodyFor('/team', createTeamMember, updateTeamMember);
bodyFor('/gallery', createGalleryItem, updateGalleryItem);
bodyFor('/categories', createCategory, updateCategory);
bodyFor('/posts', createPost, updatePost);
bodyFor('/roles', storeRoleSchema, updateRoleSchema);
bodyFor('/users', storeUserSchema, updateUserSchema);
bodyFor('/sections', null, updateSectionSchema);
bodyFor('/menus', null, updateMenuSchema);
bodies['PATCH /settings'] = updateSettingSchema;
bodies['PUT /settings'] = updateSettingSchema;
bodies['PATCH /hero'] = sectionPanelSchema;
bodies['PATCH /about'] = sectionPanelSchema;
bodies['PATCH /me'] = updateProfileSchema;
bodies['PUT /menus/reorder'] = reorderSchema;
bodies['PUT /sections/reorder'] = reorderSectionsSchema;
bodies['POST /contact'] = contactSchema;
bodies['POST /auth/login'] = loginSchema;

/** Image uploads: the browser sends the WebP variants and the original size (ADR 017); the favicon is one file. */
const variantsBody = z.object({
  variants: z.array(z.string().openapi({ type: 'string', format: 'binary' })).min(1).max(3),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
const faviconBody = z.object({ image: z.string().openapi({ type: 'string', format: 'binary' }) });

const queryFor: Record<string, Schema> = {
  'GET /posts': z.object({ page: z.number().int().min(1).optional() }),
  'GET /users': z.object({ page: z.number().int().min(1).optional() }),
  'GET /public/posts': z.object({ page: z.number().int().min(1).optional(), category: z.string().optional() }),
  'GET /contact-messages': z.object({ page: z.number().int().min(1).optional(), unread: z.string().optional() }),
  'GET /public/pricing': z.object({ service_id: z.number().int().optional() }),
};

const dataOf = (s: Schema, many: boolean) => z.object({ data: many ? z.array(s) : s });
const page = (s: Schema) =>
  z.object({
    data: z.array(s),
    links: z.object({ first: z.string().nullable(), last: z.string().nullable(), prev: z.string().nullable(), next: z.string().nullable() }),
    meta: z.object({
      current_page: z.number().int(), from: z.number().int().nullable(), last_page: z.number().int(), per_page: z.number().int(),
      to: z.number().int().nullable(), total: z.number().int(),
    }),
  });

interface Doc { status: number; schema?: Schema }

/** Response by convention; the few special routes are listed first. */
function responseFor(method: string, path: string): Doc {
  const key = `${method.toUpperCase()} ${path}`;
  const special: Record<string, Doc> = {
    'GET /health': { status: 200, schema: z.object({ status: z.enum(['ok', 'degraded']), database: z.enum(['ok', 'fail']) }) },
    'GET /meta/locales': { status: 200, schema: dataOf(Locales, false) },
    'GET /public/captcha': { status: 200, schema: dataOf(Captcha, false) },
    'POST /contact': { status: 201, schema: dataOf(Received, false) },
    'GET /dashboard': { status: 200, schema: dataOf(Counts, false) },
    'GET /permissions': { status: 200, schema: dataOf(z.string(), true) },
    'GET /me/menus': { status: 200, schema: dataOf(MenuNode, true) },
    'PUT /menus/reorder': { status: 200, schema: dataOf(Reordered, false) },
    'PUT /sections/reorder': { status: 200, schema: dataOf(Reordered, false) },
    'GET /site/status': { status: 200, schema: dataOf(SiteStatus, false) },
    'POST /site/publish': { status: 202, schema: dataOf(Published, false) },
    'POST /auth/login': { status: 200, schema: TokenResponse },
    'POST /auth/refresh': { status: 200, schema: TokenResponse },
    'POST /logout': { status: 204 },
  };
  if (special[key]) return special[key];
  const segs = path.split('/').filter(Boolean);
  const rest = segs[0] === 'public' ? segs.slice(1) : segs;
  const res = resources[rest[0] ?? ''];
  if (!res) return { status: 200 };
  if (method === 'delete') return ['image', 'logo', 'favicon'].includes(rest[rest.length - 1]!) ? { status: 200, schema: dataOf(res, false) } : { status: 204 };
  const hasId = rest.some((s) => s.startsWith(':'));
  if (method === 'get' && !hasId && rest.length === 1 && !['settings', 'hero', 'about', 'me'].includes(rest[0]!)) {
    return { status: 200, schema: paginated.has(path) ? page(res) : dataOf(res, true) };
  }
  const created = method === 'post' && rest.length === 1;
  return { status: created ? 201 : 200, schema: dataOf(res, false) };
}

const tagFor = (path: string): string => {
  const first = path.split('/').filter(Boolean).find((s) => s !== 'public') ?? 'misc';
  return first.replace(/^./, (c) => c.toUpperCase());
};

const openApiPath = (path: string): string => `/v1${path.replace(/:(\w+)/g, '{$1}')}`;
const idParams = (path: string): Record<string, Schema> => Object.fromEntries([...path.matchAll(/:(\w+)/g)].map((m) => [m[1]!, m[1] === 'slug' ? z.string() : z.number().int()]));

export function buildSpec(routes: RouteMeta[]): object {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  const error = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.record(z.string(), z.array(z.string())).optional() }) });

  for (const r of routes) {
    const key = `${r.method.toUpperCase()} ${r.path}`;
    const isImage = r.method === 'post' && /(?:\/image|\/settings\/(?:logo|favicon))$/.test(r.path);
    const body = isImage ? (r.path === '/settings/favicon' ? faviconBody : variantsBody) : bodies[key];
    const params = idParams(r.path);
    const out = responseFor(r.method, r.path);
    const secured = !('public' in r.access);
    const responses: Record<string, object> = {
      [String(out.status)]: out.schema ? { description: 'OK', content: { 'application/json': { schema: out.schema } } } : { description: 'No content' },
    };
    if (secured) {
      responses['401'] = { description: 'Unauthenticated', content: { 'application/json': { schema: error } } };
      if ('permission' in r.access) responses['403'] = { description: 'Forbidden', content: { 'application/json': { schema: error } } };
    }
    if (Object.keys(params).length) responses['404'] = { description: 'Not found', content: { 'application/json': { schema: error } } };
    if (body) responses['422'] = { description: 'Validation failed', content: { 'application/json': { schema: error } } };

    registry.registerPath({
      method: r.method,
      path: openApiPath(r.path),
      operationId: `${r.method}.${r.path.replace(/[/:]+/g, '.').replace(/^\.|\.$/g, '')}`,
      tags: [tagFor(r.path)],
      summary: `${r.method.toUpperCase()} ${r.path}`,
      security: secured ? [{ bearerAuth: [] }] : [],
      'x-permission': 'permission' in r.access ? r.access.permission : undefined,
      request: {
        ...(Object.keys(params).length ? { params: z.object(params) } : {}),
        ...(queryFor[key] ? { query: queryFor[key] as z.ZodObject } : {}),
        ...(body ? { body: { content: { [isImage ? 'multipart/form-data' : 'application/json']: { schema: body } }, required: true } } : {}),
      },
      responses,
    } as never);
  }

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'GD business site API', version: '1.0.0', description: 'Generated from the zod schemas and route registry (make openapi).' },
    servers: [{ url: '/api' }],
  });
}

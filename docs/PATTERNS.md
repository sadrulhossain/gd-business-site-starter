# Reference patterns

## Express API (Cloudflare Worker, MongoDB)

Reference module: access (users, roles, menus). Code lives in `api/src`. Copy these shapes.

### Module folder
`src/modules/<module>/{model,schema,routes}.ts` (single-file models live in `src/models.ts` until a module needs its own file).
- **schema.ts**: zod schemas, always `z.strictObject` (unknown keys are a 422). Bilingual text = `x` + `x_2nd`.
- **routes.ts**: `export function <module>Routes(api: Api)`, thin handlers: parse -> policy check -> query -> `toResource` -> `res.json({data})`.
- Register the function in `src/routes/v1.ts`.

### Routes and access
Every route goes through `Api` (`src/http/route.ts`): `api.get(path, access, ...handlers)`, where access is
`{public:true}`, `{permission:"module.action"}` or `{own:true}`. The helper applies `authenticate` and `can()`, records the
route, and answers other methods on a known path with a JSON 405. `test/routeAudit.test.ts` fails for a route outside
the helper, an unknown permission, or an unexpected public endpoint. Register fixed paths (`/menus/reorder`) before `/:id`.

### Permissions
One registry: `src/access/modules.ts` (`{key, actions, menu}`). It feeds the seeder, `GET /v1/permissions` and `can()`. Names are
`<module>.<action>`. The superadmin role bypasses every check and is never assignable, editable or deletable via the API; a
non-superadmin can grant only permissions they hold. Policies that depend on the target (superadmin users, self-delete) live in the handler.

### Data
- Numeric ids: `_id: Number`, allocated by `nextId(m, "<collection>")` (atomic `$inc` upsert on `counters`).
- One Mongoose connection per request (`res.locals.db()`, closed after the response); models via `res.locals.models()`.
- `sanitizeFilter` is on: an operator in a filter needs `inList()`, `notEq()` or `before()` from `src/db.ts`, and only with validated values.
  Never pass `req.query` or `req.body` into a filter; parse with zod first.
- Serialise with an explicit `toResource`; never return a document.

### Errors
`throw new HttpError(status, code, message, details?)` or `validationError({field:[messages]})` (422, legacy shape:
`{error:{code:"unprocessable", message:<first>, details:{field:[...]}}}`). 5xx messages are hidden unless APP_DEBUG.
Lists are Laravel-shaped (`paginate()`: `{data, links, meta}`, 15 per page).

### Auth (ADR 016)
Access JWT (HS256, jose, 15 min, memory only in the admin) + rotating refresh token in a host-only httpOnly cookie. Cookie endpoints
(`/auth/refresh`, `/logout`) need `X-Requested-With: gd-admin` and a trusted Origin. Rate limits are Mongo TTL counters (`hit()`).

### Seeds
`pnpm --filter @gd/api seed` (`src/seed/seed.ts`): create-if-missing only, so edits survive; the superadmin is created from `SUPERADMIN_*`.

### Tests
Vitest + Supertest on the compose Mongo; `useDb()` drops and re-indexes `<MONGODB_DB>_testing`; `actingAs(m, role, permissions)` returns a bearer header.

---

### Bilingual fields (M3)
- `bilingual({title:{max:150,required:true}})` (src/support/bilingual.ts) returns `title` and `title_2nd`; the twin is always optional and nullable with the same max. Spread it into `z.strictObject`. On update a required field may be omitted but not emptied.
- Public routes add `localizePublic(env)`: no `?lang` returns both languages, `?lang=<supported>` collapses `x_2nd` into `x` (empty twin falls back to the first language) and always strips `_2nd` keys, an unsupported value is a 422 on `lang`.

### Media (M3, ADR 017)
- No storage binding. The browser makes the WebP variants (480/960/1600, quality 82, never upscaled) and posts them in ONE multipart request (`variants` x1-3, `width`, `height`); the favicon posts one `image` (.ico or .png, 100 KB).
- Server side (src/media): declared size checked before reading, type by magic bytes, pixel cap 36,000,000, paths generated server-side as `media/<dir>/<random32>/<width>.webp`, one GitHub commit per upload (retry 3 times when the branch moved), image stored on the owner as `{path,width,height,variants,committed_at}`.
- Replace or delete: save the document first, then `removeImage()` queues the old files in a second commit through `defer()` (ctx.waitUntil, best effort). Reads never call GitHub; public URL = MEDIA_BASE_PATH + path.
- MEDIA_MAX_FILES is counted from stored documents in `countMediaFiles`: add each new media-owning model there.

### Content change tracking (M3)
- `schema.plugin(markDirtyPlugin, {tags:['faqs']})` records `{dirty_at, tags}` in `site_state` after every create, update, delete and bulk write of the model. Call `markDirty(db, tags)` for changes made outside a model. M5 turns it into a rebuild.

### Content modules with contentRoutes (M4)
- A plain ordered content module (FAQs, services, testimonials, team, gallery) is: its Mongoose model in models.ts (via `content()`, which adds the tag plugin and the is_visible+sort_order index), `modules/<name>/schema.ts` (zod create/update with `bilingual()` and `orderFields`, plus the resource mapper) and `modules/<name>/routes.ts` (one `contentRoutes()` call).
- `contentRoutes` (src/support/content.ts) registers GET/POST /<path>, GET/PATCH/PUT/DELETE /<path>/:id, optional POST/DELETE /<path>/:id/image, GET /public/<path> and optionally /public/<path>/:id. Order is always sort_order then _id. Hooks: `check` (refuse before writing), `map`, `prepare` (related rows), `list` (custom queries), `afterDelete` (cascade).
- Legacy lists are not paginated and have no reorder routes, so these modules do not add either. Delete returns 204, create 201, price-like decimals are stored as numbers and returned as "120.00".
- Cascades are explicit: deleting a service deletes its pricings in `afterDelete` (legacy FK ON DELETE CASCADE).

### Blog, contact, publish (M5)
- Rich text goes through `cleanHtml()` (src/support/sanitize.ts, the ADR 013 library, legacy allow-list) in the zod schema (`.transform`), so every write path is sanitised; blank becomes null. The hostile-payload corpus in test/sanitize.test.ts is permanent: add a payload for every bypass found.
- Slugs: optional on create (`slugify(title)` plus -2, -3 for a free one), frozen once `is_published`. Database checks that the form request did in Laravel (unique slug, category exists) run next to the zod parse so one 422 lists every field.
- Public one-time tokens (captcha): one atomic `findOneAndDelete` that also checks `expires_at` in the query; a TTL index only tidies up. Compare answers with `timingSafeEqual`.
- Anything that must not fail the request (notifications) runs through `defer()`; adapters throw errors with a fixed message and the status code, never the URL or key.
- Throttles use `hit()` before parsing, so invalid submissions count too.
- Time-dependent logic takes `now: Date` as a parameter (publishTick, dailyTick) so tests inject the clock. Mongoose plugins and `markDirty` still use the real clock.
- Operators in filters must be built with the helpers in db.ts (`after`, `before`, `upTo`, `between`, `inList`, `notEq`); spreading two trusted objects loses the trust, use one helper call.
- The contract: `make openapi` regenerates packages/api-types from the zod schemas and the route registry (src/openapi). A new route needs: its body schema in src/openapi/spec.ts (`bodies`), a response schema in src/openapi/responses.ts when it is a new resource, and any deliberate difference from legacy in docs/CONTRACT-DIFFS.md. test/openapi.test.ts fails when the committed file is stale.

### Admin app (M6)
- Auth: `auth/session.ts` is the only place that talks to /auth/*. The access token lives in the zustand store (memory); the refresh token is an httpOnly cookie. `refreshTokens()` is single-flight, `getValidToken()` renews within 60 s of expiry, a 401 triggers one refresh and one retry (api-client `onUnauthorized`). `RequireAuth` runs one silent `restoreSession()` per page load, then redirects to /login with `{ from }` in router state.
- The api-client takes `baseUrl` and `credentials` from the app; the admin passes `include`. Cookie calls need the header `X-Requested-With: gd-admin`.
- Images: `lib/upload.ts` `uploadImage()` builds WebP variants in the browser (480/960/1600, never upscaled, 36 MP cap read from the file header before decoding) and sends only those with `width` and `height`; the favicon goes as the plain file. `ImagePanel` shows the local blob until the published file loads.
- Base path: Vite `base` and router `basename` are `/admin`; use `import.meta.env.BASE_URL` for public assets. Admin CSP rules live in `web/admin/public/_headers.admin` for M8 to merge.

### Portal static export (M7)
- No server features: no route handlers, no middleware, no `revalidate`, no `searchParams`, no `headers()`. Every read goes through `lib/api.ts` (build time only, `BUILD_API_URL`, 3 attempts).
- URLs: always `localePath(locale, path)` (final URL with trailing slash); blog lists with `blogPath()`. Never build a URL by hand.
- A new dynamic route needs `generateStaticParams` for every locale, `dynamicParams = false`, and `orSentinel()` so an empty list does not fail the export.
- Client code may read only `NEXT_PUBLIC_API_URL`. Anything else from the environment belongs in server components at build time.
- Images: `Picture` builds `srcset` from the record's `webp` map; do not guess file names.

### New content module checklist (M3)
1. Schema in models.ts with the plugin and `getModels` entry; 2. zod schema with `bilingual()`; 3. routes via `Api` (public ones with `localizePublic`); 4. entry in access/modules.ts (permissions, menu, admin grant); 5. seed with `$setOnInsert` only; 6. media owner added to `countMediaFiles` (src/media/service.ts, list of models with an image); 7. routeAudit public list; 8. tests (auth, validation, ?lang, markDirty).

## History

The Laravel patterns (v1, MariaDB, OAuth) were removed with `legacy-api/` in Phase M10. They are in git history at the tag `laravel-v1.0.0`; nothing in the current stack follows them.

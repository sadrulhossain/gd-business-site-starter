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

### New content module checklist (M3)
1. Schema in models.ts with the plugin and `getModels` entry; 2. zod schema with `bilingual()`; 3. routes via `Api` (public ones with `localizePublic`); 4. entry in access/modules.ts (permissions, menu, admin grant); 5. seed with `$setOnInsert` only; 6. media owner added to `countMediaFiles` (src/media/service.ts, list of models with an image); 7. routeAudit public list; 8. tests (auth, validation, ?lang, markDirty).

## Legacy (Laravel)

Kept until M10. Reference module: Sections (`Section*` under `legacy-api/app`); singleton reference: Settings.

Copy these shapes, do not invent new ones. Reference module: Sections (`Section*` under `api/app`);
singleton reference: Settings. Paths below are relative to `api/app` unless noted.

### New module checklist
1. **Migration + Model**: `#[Fillable]`, `casts()`. Bilingual text = columns `x` + `x_2nd`, `use HasSecondLanguage`.
2. **Policy** `Policies/<Model>Policy.php`: one method per action, `$user->checkPermissionTo('<module>.<action>')`.
   Permission names are `<module>.<action>`; the superadmin passes via `Gate::before`.
3. **FormRequest** `Http/Requests/Api/V1/<Action><Model>Request.php`: `authorize()` returns
   `$this->user()?->can('<ability>', $model)` (403 comes before validation). `rules()` use `sometimes`
   for PATCH and wrap bilingual fields in `Bilingual::rules([...])`.
4. **Resource** `Http/Resources/Api/V1/<Model>Resource.php`: explicit field list, both languages, no model dumps.
5. **Controller** `Http/Controllers/Api/V1/<Model>Controller.php`: thin. Reads call `Gate::authorize()`; writes
   type-hint the FormRequest, `$model->update($request->validated())`, return the Resource. The first docblock
   line is the Scramble title. Never build error JSON by hand: `Exceptions/JsonErrorRenderer` shapes it.
6. **Routes** in `routes/api.php`, inside the `auth:api` group: `apiResource(...)->only([...])`, `apiSingleton`
   for one-row tables; no create/delete for seeded rows. Non-model routes use `->middleware('can:<perm>')`.
7. **Seeder** `database/seeders/<Module>ModuleSeeder.php` extends `ModuleSeeder` (permissions, menu tree, role
   grants). Seed defaults with `firstOrCreate` so re-seeding never overwrites edits. Add it to `DatabaseSeeder`.
8. **Tests** `tests/Feature/<Module>/`: 401 anonymous, 403 missing permission, happy path, 422 validation
   (assert the field keys), seeder idempotence. Authenticate with `actingAsRole($role, [$perms])` (`tests/Pest.php`).

### Uploads
- `Services/MediaService`: `store($file, '<dir>')` returns the path kept in the model's `image` column;
  `describe($path)` goes in the Resource; `delete($old)` on replace or remove.
- Images upload through their own multipart endpoint: `POST|DELETE <resource>/{id}/image`
  (`SectionImageController`). Validate with `MediaService::imageRules()` (mime by content, size, dimensions).
- Files live at `<dir>/<random>/original.<ext>`; the queued `Jobs/GenerateWebpVariants` adds `<width>.webp`.

### Config and environment
- `env()` is read only in `config/*.php` (e.g. `config/locales.php`, `config/uploads.php`).
- Tests force their environment in `tests/bootstrap.php` (testing DB, array cache, sync queue); compose env
  beats phpunit.xml. Each compose service lists its own `environment:` (see `x-php` in `docker-compose.yml`).

### Public reads, contact, webhook (phase 6)
- Public reads live in the `LocalizePublicResponse` route group (`public/*`): the controller's `publicIndex`/`publicShow` skips
  `Gate::authorize` and returns visible rows only. `?lang=` collapses `x`/`x_2nd` pairs; no per-resource code is needed.
- Rich text: assign it to a model attribute whose setter calls `Services/HtmlSanitizer` (see `Post::body`); never sanitise in controllers.
- Public forms: honeypot field (`prohibited` rule), `Services/Captcha` checked in the FormRequest's `after()`, named limiter in
  `AppServiceProvider`, queued Notification to `Notification::route('mail', ...)`. Answer with `{"data":{"received":true}}`.
- Content-change webhook: add the model to the list in `AppServiceProvider::boot()` (it gets `ContentObserver`); tag = table name.
  Not for private data (contact messages). Tests use `Http::fake()` per test.
- OpenAPI: `make openapi` exports Scramble's spec to `packages/api-types/openapi.json`; commit it when routes change.

### Frontend (phase 7)
- Theme: import `tailwindcss` then `@gd/tokens/<app>.css` in the app's one CSS file. Use token utilities (`bg-primary-600`, `text-ink`,
  `border-line`, `font-display`), never raw hex. New tokens go in packages/tokens, not in an app.
- Data: type API data with `components['schemas'][...]` from `@gd/api-types`; call the API with `@gd/api-client` (`createClient`), never raw fetch.
- Regenerate after API changes: `make openapi` (migrated DB), then `pnpm generate:types`; commit both outputs.
- Tailwind only sees literal class names: map values to full class strings, do not build them with template pieces.

### Admin module (phase 8)
- A CRUD screen is one entry in `web/admin/src/modules.ts`: `key` (permission prefix: `<key>.view|create|update|delete`), `path` (matches the
  `/me/menus` row), `endpoint`, `columns`, `fields` (`bilingual: true` renders "Title (EN)" / "Title (FR)" from `/v1/meta/locales`). The router,
  permission gate and buttons follow from it; add a page component only when the screen is not plain CRUD.
- Calls go through `src/api.ts` (token + refresh handled); never read tokens from the store in components. Use `can('x.y')` for UI gating,
  the API remains the authority.
- Shared pieces: `DataTable`, `FormField`, `BilingualField`, `ConfirmDialog`, `Toast`; do not add a second of any.

### Admin modules (phase 9)
- CrudPage extensions, each used by two modules: `type: 'checkgroup'` (string[]; grouped options render a matrix) with `optionsFrom`
  (options fetched from the API) for users/roles; `reorder: {endpoint, group?}` (drag rows, sends `PUT {ids}`) for sections/menus.
- Inline boolean save in a table cell: `ToggleCell` from a column's `render`. Not a CrudPage feature.
- Single-record screens are not CrudPage: `SettingsPage` + a `SingletonConfig` (tabs of dot-path fields, e.g. `hours.mon.open`).
- API: reorder endpoints are `PUT <resource>/reorder {ids}` registered before the resource route (`ReorderRequest` subclass per table).
  The superadmin role is never assignable, editable or deletable through the API; a non-superadmin can only grant permissions they hold.

### Content modules (phase 10)
- `image: true` on a CrudConfig adds the image panel to the edit form (`POST|DELETE <endpoint>/<id>/image`); show it in the list with a column `render`.
- Uploads use `lib/upload.ts` `uploadFile` (XHR, for progress; same token refresh as the client). Validate with `checkImage` first, the API stays the authority.
- Bulk upload is `GalleryUploader` (create item, then upload; a failed upload deletes the empty item), mounted via `pages` in router.tsx.
- Read-only screens that are not CrudPage (contact inbox) are a page plus an `InboxConfig` (`messagesConfig.ts`).

### Blog and profile (phase 11)
- Rich text: field `type: 'richtext'` (TipTap, `components/RichText.tsx`, HTML in and out; works with `bilingual`). Keep its extensions inside the
  HtmlSanitizer allowlist (api `HtmlSanitizer::ALLOWED`); add a tag there first if the editor needs one.
- `status` (draft|published) is the API's view of `is_published` (`ResolvesPostStatus`); forms use `status`, never the boolean.
- Own account: `PATCH /v1/me` (`ProfileController`), page `pages/Profile.tsx`; no permission, any signed-in user.

### Portal (phase 12)
- Locales: `lib/i18n.ts` reads LOCALE_DEFAULT / LOCALE_SUPPORTED. `proxy.ts` rewrites unprefixed paths to `/<default>/...` and redirects an explicit
  default prefix away; pages live under `app/[locale]/`. Build links with `localePath(locale, path)`, never by hand. Env is server-only: client
  components take `locales` / `unprefixed` as props (see `LanguageSwitcher`).
- Text: `messages/en.json` (default locale) and `messages/second.json` (second); add every key to both. Content text comes from the API with `?lang=`.
- Data: only through `lib/api.ts` (`apiFor(locale)`, server side, `API_INTERNAL_URL`). Reads are `revalidate: 3600` and tagged with the API table name;
  `POST /api/revalidate` (HMAC, same secret as the API webhook) expires a tag. New public resource: add it to `TAGS` there.
- Sections: add a view to `components/sections/index.tsx` keyed by the section `key`; the renderer skips `is_visible: false` and falls back to a generic view.
- Styling: logical utilities only (`ms-`, `me-`, `ps-`, `pe-`, `text-start`, `border-s`), so RTL locales work. `images.unoptimized` is on: use `components/Media.tsx`.
- Dev note: after changing a server component that a client component consumes, a stale Turbopack cache can serve old props; `rm -rf web/portal/.next` and restart node.
- Screenshots: `docker compose --profile e2e run --rm --no-deps -T -w /app/web/portal e2e npx playwright test`.

### Portal pages (phase 13)
- A page for a section is `lib/section-page.tsx` `sectionPage('<key>', [extra keys])` in a two-line `page.tsx`: it renders the same `SectionBlock` view as Home
  (title becomes the h1) and 404s when the section is hidden. Add the key to `SECTION_PAGES` so the header links to the page instead of a Home anchor.
- Static legal text (`privacy`, `terms`) lives in `messages/*.json` under `legal`, with `{site}` / `{email}` filled from settings (`lib/legal-page.tsx`).
  It is a generic template: the business must review it.
- `getMessages` falls back key by key to `en.json`, so a missing or empty entry in `second.json` shows the default text. API content does the same via `?lang=`.
- 404: `app/[locale]/[...rest]/page.tsx` calls `notFound()` for unknown paths; `not-found.tsx` must not read request headers (that makes every locale route dynamic, no ISR): `NotFoundContent` picks the locale from the URL.
- Proxy matcher: keep the double backslash in `.*\..*`; a single one silently matches nothing useful. After editing `proxy.ts` restart node with a clean `.next`.

### Blog, contact and SEO (phase 14)
- Every page builds its metadata with `lib/seo.ts` `pageMetadata({locale, path, siteName, ...})`: title, description, canonical, hreflang (all locales + x-default), Open Graph, Twitter.
  `SITE_URL` is the public origin used for all absolute URLs; `metadataBase` is set in the locale layout.
- JSON-LD goes through `components/JsonLd.tsx` (escapes `<`): LocalBusiness on Home, Article on a post. Build the objects in `lib/seo.ts`.
- `app/sitemap.ts` and `app/robots.ts` use the same cached, tagged fetches as the pages, so the revalidate webhook refreshes them. New public page: add it to the sitemap.
- Blog: `/blog` (`?category=<slug>`, `?page=n`, canonical is the plain list), `/blog/<slug>`. Post `body` is sanitised by the API and rendered as HTML in `.post-body`.
- Contact: `components/ContactForm.tsx` talks only to `app/api/contact/*` (server proxies to the API; the captcha is one-time, refetched after every submit). The honeypot field is `website`.
- Smoke tests: `web/portal/e2e/smoke.spec.ts` (`docker compose --profile e2e run --rm --no-deps -T -w /app/web/portal e2e npx playwright test smoke`). The contact test leaves one message with subject `e2e-smoke`; the blog test skips without published posts.

### Security and quality gates (phase 15)
- `make security` (also part of `make check`): `php artisan security:routes` (every `auth:api` route needs `can:` or a policy/Gate call; own-account routes are listed in `AuditRoutes::ALLOWED`), `scripts/check-secrets.sh`, `scripts/check-floors.mjs`. A new route gets its check; do not add allowlist entries.
- nginx: `include /etc/nginx/snippets/security-headers.conf;` in every server and in every location that sets its own `add_header` (those replace inherited ones). Set the CSP per vhost.
- The OAuth authorize step is S256-only (`RequirePkceS256`). Cross-origin API access is closed; list origins in `CORS_ALLOWED_ORIGINS` only when a browser app needs it.
- Portal: never read `headers()` or `cookies()` in the locale layout, `not-found.tsx` or shared components (every page turns dynamic and loses ISR). `web/portal/e2e/a11y.spec.ts` (axe) must stay at zero violations; white text needs `bg-brand-700` or darker.
- Dev edits do not reach the node container's file watcher on Windows: after changing code, stop node, delete `web/portal/.next` and start it again.

### Production (phase 16)
- Production lives in `docker-compose.prod.yml` + `docker/prod/` + `.env.prod`, never in the dev compose file. Images contain the code; nothing is bind-mounted except TLS certs. Do not publish ports other than 80/443.
- A new env variable: add it to the `x-php` (or service) `environment:` in the prod file, to `.env.prod.example` and to the production table in ENV.md. Required secrets use `${VAR:?message}`.
- A new service needs `restart: always`, a `healthcheck`, the `logging` anchor and a `depends_on` with `condition: service_healthy`.
- The portal builds on first container start (it needs the API); bump `IMAGE_ID` per release. The php entrypoint migrates and caches config; seeders are run by hand (UPGRADE.md).
- Backups: `scripts/backup.sh` / `restore.sh`. Anything new that holds state (a volume) must be added to both.

# Customize

Content (texts, images, services, posts, hours, section visibility) is edited in the admin, no code. Everything below is a code change in your fork:
edit, run `make check`, push, and the deploy workflow publishes it.

## Brand colours and fonts

Colours, radii and fonts are design tokens, one file per app, shared through the `@gd/tokens` package:

| App | File | Utilities |
|-----|------|-----------|
| Portal | `packages/tokens/portal.css` | `bg-brand-600`, `text-ink`, `border-line`, `font-display` |
| Admin | `packages/tokens/admin.css` | `bg-primary-600`, `text-ink`, `border-line` |

Change the values inside `@theme { ... }`: the ten `--color-brand-50` to `--color-brand-900` steps (portal) or `--color-primary-*` (admin), and the neutral
and semantic colours. The admin theme is light and dark; the semantic colours are CSS variables set in `:root` and `.dark` at the top of the file.

Rules that keep the site accessible and consistent:

- Use token utilities only, never raw hex in components (the tokens reset Tailwind's palette on purpose, so an unknown colour name produces nothing).
- White text on a brand colour needs 4.5:1 contrast: the portal uses `bg-brand-700` or darker behind white text. After changing the brand, run the axe spec
  (`web/portal/e2e/a11y.spec.ts`, see README) and fix any `color-contrast` it reports.
- Inline links inside a sentence need more than colour to tell them from text: underline them (axe `link-in-text-block`).
- Tailwind only sees literal class names. Write `'bg-brand-700'`, do not build class names from pieces.
- Logo and favicon: upload them in the admin under Access > Settings > General (an `.ico`, PNG, JPEG or WebP favicon). They appear after the next publish.
- Sample content: `make seed` loads demo settings, sections, services, pricing, testimonials, team, FAQs in both languages. Use `make seed-core` for a real site.
- Fonts: the portal uses the system sans-serif stack (no font download). To use a web font, self-host it under `web/portal/public`, set `--font-display`, and allow the
  font file in the portal CSP (`web/portal/public/_headers.portal`; the CSP lines are length-checked by `scripts/assemble-site.mjs`).

## A second language

One default language and at most one more, set by configuration.

1. `LOCALE_DEFAULT=en` and `LOCALE_SUPPORTED=en,bn` (any two codes): in `.env` for development, and in `wrangler.jsonc` vars for production (the deploy workflow
   passes them to the portal build as well). The portal then serves the second language at `/<code>/` (the default has no prefix), shows a language switcher and adds hreflang
   links and sitemap entries.
2. Texts that are not content live in `web/portal/messages/en.json` (the default and the fallback for a missing key) and `web/portal/messages/second.json`.
   The legal pages (`legal.privacy`, `legal.terms`) are a generic template: **have them reviewed for your business and country**.
3. Every translatable content field has a twin (`title` and `title_2nd`); the admin shows both once a second language is enabled. An empty twin falls back to the first language.
4. `<html dir>` switches to `rtl` for `ar`, `he`, `fa`, `ur`; the CSS uses logical properties (`ms-*`, `text-start`, `border-s`), so layouts mirror without extra rules.
5. A pair other than English and Bengali: also check `web/portal/lib/i18n.ts` (language names) and the tests and fixtures that assume `bn`.

For one language only, set `LOCALE_SUPPORTED=en`; the switcher and the `/<code>/` routes disappear.

## Add a content module (a new managed content type)

[PATTERNS.md](PATTERNS.md) is the contract: "New content module checklist" and "Content modules with contentRoutes". The shortest path is to copy a close relative
(FAQs for a plain ordered list, Services for a list with an image, Settings for a single row):

1. API: the model in `api/src/models.ts` (`content()` for an ordered module, which adds the change-tracking plugin and the visibility and order index) and its `getModels` entry.
2. API: `api/src/modules/<name>/schema.ts` (zod create/update with `bilingual()`, strict objects) and `routes.ts` (one `contentRoutes()` call; public reads use `localizePublic`).
3. API: one entry in `api/src/access/modules.ts` (permissions `<name>.view|create|update|delete`, a menu row, which roles get it). The route audit test fails for any route without a
   permission, so a forgotten entry shows up immediately.
4. Seed: create-if-missing only (`$setOnInsert`), in `api/src/seed/seed.ts`; add demo rows to `demo.ts` if you want them.
5. Indexes: anything that grows and is listed or filtered needs an index in `models.ts` and a case in `api/test/indexes.test.ts` (an explain plan that must not scan or sort in memory).
6. `make openapi`, then commit `packages/api-types`.
7. Admin: one object in `web/admin/src/modules.tsx` (next section). Plain CRUD needs no page component.
8. Portal, if it shows the data: a fetch function in `web/portal/lib/api.ts`, then a page or component. Add a public page to `web/portal/app/sitemap.ts` and to the axe page list in
   `e2e/a11y.spec.ts`.
9. `make t FILTER=<name>` while working, `make check` at the end. The deploy rebuilds the portal on the next publish.

## The admin CrudPage config

Every list-and-form screen in the admin is one object in `web/admin/src/modules.tsx`, typed by `CrudConfig` (`web/admin/src/components/CrudPage.tsx`). The sidebar entry comes
from the API (`/me/menus`), which is why the module also needs its menu row in `api/src/access/modules.ts`.

| Key | Meaning |
|-----|---------|
| `key`, `path`, `title`, `noun` | permission prefix (`faqs` gives `faqs.view` and so on), route, page title, singular word for dialogs |
| `endpoint` | the collection, for example `/v1/faqs`; rows live at `${endpoint}/${id}` |
| `columns` | `{ key, header, render? }` for the table |
| `fields` | `{ name, label, type?, bilingual?, required?, hint?, options?, optionsFrom?, initial? }`; `bilingual: true` renders `name` and `name_2nd` |
| `rowLabel` | text identifying a row in the delete confirmation |
| `canCreate`, `canDelete` | set to `false` for seeded, edit-only modules (sections) |
| `image` | the rows have an image at `${endpoint}/${id}/image` |
| `reorder` | drag rows to reorder; sends `PUT endpoint {ids}` |

Buttons the signed-in user is not allowed to use are not rendered; the API checks the permission again either way.

## Add a section to the home page

Sections are the blocks of the home page (hero, about, services, contact, ...). The admin can show, hide, reorder and edit their text and image; code is needed only for a new kind.

1. API: add the key and its default title to `DEFAULT_SECTIONS` in `api/src/modules/sections/routes.ts` (optional sections start hidden). Seeding (`make seed-core`) creates missing rows only.
2. Portal: render it in `web/portal/components/sections/index.tsx` (`SectionBlock` picks the view by `section.key`; the generic text and image view is the default, so a text-only section needs no code).
   If it lists data (like services), fetch it in `lib/api.ts` and pass it in.
3. Optional own page (`/about`, `/services`, ...): add the key to `SECTION_PAGES` in `web/portal/lib/section-page.tsx`, create `app/[locale]/<key>/page.tsx` containing
   `export default sectionPage('<key>')` (copy `about/page.tsx`), and add it to the sitemap.
4. Fixed labels go in both message files.
5. Run the axe spec and `make check`.

## Publish timing

Saving content in the admin (and a media upload) does not rebuild the site at once. The Worker notes the change and a cron (every 15 minutes) asks GitHub Actions to run
`deploy.yml` when the change has been quiet for `PUBLISH_QUIET_MINUTES` (default 2) and no build started in the last `PUBLISH_DEBOUNCE_MINUTES` (default 5). The admin's "Publish now"
button (permission `site.publish`, one use a minute) dispatches at once. To change it, edit `PUBLISH_DEBOUNCE_MINUTES` in `wrangler.jsonc` (and `PUBLISH_QUIET_MINUTES` if you add it there; the default is used otherwise) and deploy.
Shorter is more builds: each takes roughly 4 to 8 minutes of GitHub Actions time, which is free for a public repository and counted against the monthly allowance for a private one (docs/LIMITS.md).
The cron schedule itself is `triggers.crons` in `wrangler.jsonc`; Free allows five triggers and this uses two.

## Contact-form mail

`MAIL_PROVIDER=none` (the default) keeps messages in the admin inbox only. `webhook` posts each message to `NOTIFY_WEBHOOK_URL`; `http` calls a mail API (`MAIL_API_URL`,
`MAIL_API_KEY`, `MAIL_FROM_ADDRESS`, `CONTACT_NOTIFY_TO`). The API has no SMTP option (the mail path is an HTTPS call). Details: docs/ENV.md.

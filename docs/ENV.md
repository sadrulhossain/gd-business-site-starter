# Environment variables

Where each variable lives:

- **Dev**: root `.env` (untracked), copied from `.env.example` by `make up`. Compose reads it for interpolation only; each service lists its own `environment:`. Outside Docker, `api/.dev.vars` (from `api/.dev.vars.example`) feeds `wrangler dev`. Commit only `*.example` files.
- **Worker var**: a plain value in `vars` of the root `wrangler.jsonc` (production). It is committed, so never put a secret there. `wrangler.jsonc` must stay plain JSON (no comments): `scripts/wrangler-vars.mjs` reads it.
- **Worker secret**: set with `wrangler secret put NAME -c ../wrangler.jsonc` from `api/`; never in a file. Steps: [DEPLOY.md](DEPLOY.md).
- **Build**: set only while a build runs (the deploy workflow sets them).
- **GitHub secret**: repository Settings, Secrets and variables, Actions.
- **Seed**: typed in your shell when you run `pnpm --filter @gd/api seed [-- --demo]`.

Versions of images and packages are pinned in `docs/VERSIONS.md`; the `*_VERSION` entries in `.env.example` must match it (`make versions`).

| Variable | Where | Default | Notes |
|----------|-------|---------|-------|
| MONGODB_URI | Worker secret; dev; seed; CI | dev `mongodb://mongo:27017` | Atlas string of the **readWrite** user, with `/gd-business-site-starter` and `serverSelectionTimeoutMS=5000` |
| MONGODB_DB | Worker var; dev; seed | gd-business-site-starter | tests use `<MONGODB_DB>_testing` |
| JWT_ACCESS_SECRET | Worker secret; dev | none (required) | 32 or more random characters; signs the 15-minute access token |
| REFRESH_TOKEN_PEPPER | Worker secret; dev | none (required) | 32 or more random characters; keys the HMAC of refresh tokens |
| GITHUB_REPO_TOKEN | Worker secret; dev (optional) | empty | fine-grained, this repository only, Contents write and Actions write, with an expiry; without it uploads return 503 and publishing is off |
| MAIL_API_KEY | Worker secret | empty | only for `MAIL_PROVIDER=http` |
| NOTIFY_WEBHOOK_URL | Worker secret | empty | only for `MAIL_PROVIDER=webhook` |
| APP_ENV / APP_DEBUG | Worker var; dev | production / false | `APP_DEBUG=true` shows error details; never in production |
| SITE_ORIGIN | Worker var; dev; read by the deploy workflow | `https://gd-business-site-starter.<subdomain>.workers.dev` | public origin of the single Worker, no trailing slash; the only origin besides `CORS_ALLOWED_ORIGINS` allowed to call `/auth/refresh` and `/logout`; the portal build uses it as `SITE_URL` and `BUILD_API_URL` |
| CORS_ALLOWED_ORIGINS | Worker var; dev | empty (closed) | comma separated exact origins; empty in production (same origin) |
| COOKIE_NAME | Worker var; dev | `__Host-rt` | `rt` on plain-http development |
| ACCESS_TOKEN_TTL_SECONDS / REFRESH_TOKEN_TTL_DAYS | Worker var | 900 / 30 | |
| LOCALE_DEFAULT / LOCALE_FALLBACK / LOCALE_SUPPORTED | Worker var; dev; read by the deploy workflow | en / en / en | `SUPPORTED` is comma separated; the portal build derives its languages from these; the default has no URL prefix |
| UPLOADS_MAX_MB | Worker var; dev | 5 | per uploaded file |
| MEDIA_MAX_FILES | Worker var; dev | 6000 | upload refused above it (Cloudflare allows 20,000 files per deployment) |
| MEDIA_BASE_PATH | Worker var; dev | /media | public path of the `media/` folder |
| MEDIA_GIT_BRANCH | Worker var; dev | main | branch that receives media commits; must accept pushes from the token |
| GITHUB_REPO | Worker var; dev | `sadrulhossain/gd-business-site-starter` | `owner/name` |
| GITHUB_WORKFLOW_FILE / GITHUB_REF | Worker var; dev | deploy.yml / main | the workflow the API dispatches and the ref it runs on (a scheduled workflow only runs from the default branch) |
| PUBLISH_DEBOUNCE_MINUTES / PUBLISH_QUIET_MINUTES | Worker var; dev | 5 / 2 | at most one dispatch per debounce window; a change must be quiet this long first |
| CAPTCHA_TTL_SECONDS | Worker var; dev | 600 | |
| CONTACT_PER_MINUTE | Worker var; dev | 5 | per IP |
| CONTACT_NOTIFY_TO | Worker var; dev | empty | fallback recipient when Settings has no email |
| MAIL_PROVIDER | Worker var; dev | none | `none` (messages only in the admin inbox), `webhook` or `http` |
| MAIL_API_URL / MAIL_FROM_ADDRESS | Worker var; dev | Resend URL / empty | `http` provider only; the sender must be one the provider accepts |
| VITE_API_URL | Build (admin) | empty | empty in production and in dev: calls go to `/api/...` on the same origin (Vite proxies in dev) |
| NEXT_PUBLIC_API_URL | Build (portal) | empty | empty in production: the contact form calls `/api/v1/...` on the same origin. Dev: `http://localhost:28302` |
| BUILD_API_URL | Build (portal) | dev `http://localhost:28302/api` | absolute address of the live Worker **including `/api`**; read only by build-time fetches; the deploy sets it to `$SITE_ORIGIN/api` |
| SITE_URL | Build (portal); dev | dev `http://localhost:28300` | public origin for canonical URLs, Open Graph, sitemap and robots; the deploy sets it to `SITE_ORIGIN` |
| SUPERADMIN_NAME / SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD | Seed | `Super Admin` / empty / empty | the superadmin is created only when email and password are set; an existing password is never reset |
| CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID | GitHub secret | none | deploy only; token scoped to Workers Scripts on this one account |
| BACKUP_MONGODB_URI | GitHub secret | none | the **read-only** Atlas string, for the weekly backup |
| INDEXES_MONGODB_URI | GitHub secret (optional) | none | the readWrite string; lets `deploy.yml` create new indexes before the new code goes live. Without it the daily cron does it |
| BACKUP_PASSPHRASE | GitHub secret | none | encrypts every backup; keep a copy elsewhere |
| COMPOSE_PROJECT_NAME / COMPOSE_PROFILES | Dev (compose) | gdsite / dev | container names are `${COMPOSE_PROJECT_NAME}-<tech>` |
| NODE_VERSION, NODE_DEBIAN_SUFFIX, MONGO_VERSION, NEXT_VERSION, VITE_VERSION, REACT_VERSION | Dev (compose); CI | see VERSIONS.md | `MONGO_VERSION` is also the image of the CI Mongo service and the backup's `mongodump` |
| MONGO_PORT, PORTAL_DEV_PORT, ADMIN_DEV_PORT, API_DEV_PORT | Dev (compose) | 28017, 28300, 28301, 28302 | host ports, bound to 127.0.0.1; `make ports` checks them |

Cron triggers are set in `wrangler.jsonc` (`triggers.crons`): every 15 minutes (publish tick) and `17 3 * * *` (daily Atlas ping and cleanup of expired captchas and refresh tokens). No storage bindings exist; the only binding is `ASSETS`.

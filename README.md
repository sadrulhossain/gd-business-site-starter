# gd-business-site-starter

A small-business website that runs on free tiers: a public site in two languages, an admin app to edit everything, and one API, all served
from a single Cloudflare Worker with a MongoDB Atlas database. No server to look after and no monthly bill at normal traffic.

Content: hero, about us, sections, services, pricing (per service), team, testimonials, gallery, FAQ, blog, contact inbox, settings (logo, favicon,
hours, socials), users, roles and permissions.

## How it fits together

```
 visitor ──▶ Cloudflare (one origin) ─┬─ /            static portal (Next.js export), built by GitHub Actions
                                       ├─ /media/*     images, committed to this repository
 editor  ──▶ /admin/                   ├─ /admin/*     static admin app (Vite, React)
                                       └─ /api/*       Express 5 on a Worker ──▶ MongoDB Atlas (M0)
 GitHub Actions: tests, build, deploy with wrangler, weekly encrypted backup
```

- **Visitors never touch the API** except the contact form. The portal is plain files, so traffic does not spend Worker requests or database operations.
- **Editing is publishing.** Saving content in the admin asks GitHub Actions (after a quiet period, at most one build per 5 minutes) to rebuild the portal from the API and deploy it.
- **Images** are uploaded in the admin and committed to `media/` through the GitHub API, then served as static files.
- The free-tier numbers this depends on, with sources and dates: [docs/LIMITS.md](docs/LIMITS.md).

| Part | Where | Stack |
|------|-------|-------|
| API | `api/` | Express 5, Mongoose 9, zod, jose; one Worker (wrangler, `nodejs_compat`) |
| Portal | `web/portal` | Next.js 16 static export, Tailwind 4 |
| Admin | `web/admin` | Vite, React 19, TanStack Query, TipTap |
| Shared | `packages/` | design tokens, typed API client, OpenAPI types |

Versions and their security floors: [docs/VERSIONS.md](docs/VERSIONS.md).

## Quick start (development)

You need Docker with Compose, `make` and a browser. Nothing else is installed on the host.

```sh
git clone <your fork> site && cd site
make up        # creates .env from .env.example, checks ports, starts MongoDB, the API (wrangler dev), admin and portal (a Mailpit container also starts; the API does not send SMTP mail)
```

Before the first seed, open `.env` and set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` (12 characters or more), and replace the `dev-only-` secrets if you
will expose the stack beyond your machine. Then:

```sh
make seed      # roles, permissions, menus, the superadmin, plus demo content in English and the second language
make seed-core # the same without the demo content (use this for a real site)
```

| URL | What |
|-----|------|
| http://localhost:28300 | Portal (`/bn/` for the second language when `LOCALE_SUPPORTED` has one) |
| http://localhost:28301/admin/ | Admin: sign in with the superadmin |
| http://localhost:28302/api/v1/health | API health |

Ports come from `.env`; `make ports` checks they are free. Contact-form messages appear in the admin inbox (mail is off by default: `MAIL_PROVIDER=none`, see docs/ENV.md). The seed is idempotent: running it twice changes nothing.

| Command | What |
|---------|------|
| `make up` / `make down` | start / stop the local stack |
| `make seed` / `make seed-core` | idempotent seed with / without demo content |
| `make t FILTER=Name` | targeted API tests (Vitest `-t`) |
| `make openapi` | regenerate `packages/api-types` from the zod schemas and run the parity check against `docs/legacy-openapi.json` |
| `make versions` | check `.env` `*_VERSION` pins against `docs/VERSIONS.md` |
| `make security` | secrets scan, version floors, `pnpm audit --prod` |
| `make check` | typecheck, all tests, versions, parity, security (run once per change set; needs the stack up) |

Portal browser tests (Playwright and axe, against a static export built from a fixture API):
`docker run --rm --ipc=host -v "$PWD:/app" -w /app/web/portal mcr.microsoft.com/playwright:v1.65.0-noble node scripts/e2e.mjs`.
It builds the portal and runs two browsers' worth of tests, so it needs free memory: on a 4 GB Docker VM stop other containers first.

## Deploy

Free Cloudflare, Atlas and GitHub accounts, one GitHub Actions workflow, no build minutes on Cloudflare. The step-by-step checklist, every secret and the first-deploy
order are in [docs/DEPLOY.md](docs/DEPLOY.md). Run its "verify" part once after the first deploy: it measures the two things that cannot be tested locally
(CPU time per request and the rate limits on the real Worker).

## Environment

Every variable, where it is set (`.env` for development, `wrangler.jsonc` vars, Worker secrets, GitHub secrets) and its default: [docs/ENV.md](docs/ENV.md).

## Documentation

| File | Read it for |
|------|-------------|
| [docs/DEPLOY.md](docs/DEPLOY.md) | accounts, tokens, first deployment, backup and restore, rollback |
| [docs/LIMITS.md](docs/LIMITS.md) | every free-tier limit, what this site uses, measurements |
| [docs/SECURITY.md](docs/SECURITY.md) | review findings, tests, accepted risks, what is not verified |
| [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md) | brand, second language, new content modules, admin screens, publish timing |
| [docs/UPGRADE.md](docs/UPGRADE.md) | bumping pins, wrangler and Mongoose, when a limit changes, moving to a paid plan or a Node host |
| [docs/PATTERNS.md](docs/PATTERNS.md) | the code shapes to copy |
| [docs/ENV.md](docs/ENV.md) | environment variables |
| [docs/DECISIONS.md](docs/DECISIONS.md), [docs/PHASES.md](docs/PHASES.md) | why things are the way they are, what was built when |
| [CHANGELOG.md](CHANGELOG.md) | releases and known limits |

## History

Version 1 (Laravel, MariaDB, OAuth, VPS) is kept as history only: the git tag `laravel-v1.0.0`, `docs/PHASES-laravel.md` and the API contract
`docs/legacy-openapi.json` (the new API is checked against it by `make openapi`). The code was removed in v2.0.0. There is no importer for v1 data; see
[CHANGELOG.md](CHANGELOG.md).

## Repository map

```
api/        Express API (one Worker)   docker/     local dev Dockerfile and entrypoint
web/admin   Admin SPA                  docs/       the documents above
web/portal  Public portal              scripts/    asset assembly, checks (floors, secrets, parity), measurements
packages/   tokens, api-client, api-types      media/   uploaded images (from the admin)
.github/    CI, deploy and backup workflows
```

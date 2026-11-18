# Changelog

Format: [Keep a Changelog](https://keepachangelog.com), versions follow [SemVer](https://semver.org).
Each entry lists new environment variables and seed steps, because upgrades need them (see docs/UPGRADE.md).

## [2.0.0] - 2026-11-18

A rewrite onto free tiers: the Laravel, MariaDB and VPS stack of 1.0.0 is replaced. Version 1 stays available as the tag `laravel-v1.0.0`.

### Breaking changes
- **API**: Laravel 13 (PHP) became Express 5 (Node) on one Cloudflare Worker. The v1 API contract is kept (`docs/legacy-openapi.json`; `make openapi` checks parity and `docs/CONTRACT-DIFFS.md` lists the intended differences).
- **Auth**: OAuth 2 with PKCE (Passport) was replaced by a 15-minute bearer access token plus a rotating refresh-token cookie (`__Host-rt` in production, HttpOnly, Secure, SameSite=Lax). Existing sessions and tokens do not carry over; everyone signs in again. Passwords are PBKDF2-SHA256 (100,000 iterations), so v1 password hashes do not work: users must be re-created or reset.
- **Database**: MariaDB became MongoDB Atlas (free M0), with Mongoose. Ids stay numeric. **There is no importer for v1 data** (different hashing, different auth tables, no realistic one-to-one mapping for users and tokens); re-enter content in the admin or write a one-off script from the v1 tables.
- **Portal**: Next.js ISR server became a static export (`/`, `/bn/`, ...) built by GitHub Actions from the live API and served by Cloudflare. Content changes appear after a publish (a few minutes), not at once.
- **Admin**: now served by the same Worker at `/admin/` (single origin with the API and the portal).
- **Deployment**: no VPS, Docker in production or nginx. Cloudflare Workers and Atlas free tiers, deployed by `.github/workflows/deploy.yml` with a pinned wrangler. `docker-compose.prod.yml`, `.env.prod.example`, `scripts/backup.sh` and `restore.sh` are gone; backups are a weekly encrypted `mongodump` workflow.
- **Images**: uploads are committed to `media/` in this repository through the GitHub API and served as static files (no uploads volume).
- **Environment**: new variables (`MONGODB_URI`, `MONGODB_DB`, `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `GITHUB_REPO`, `GITHUB_REPO_TOKEN`, `PUBLISH_*`, ...) and removed ones (all `APP_KEY`, `DB_*`, `OAUTH_*`, `MARIADB_*`); see `docs/ENV.md`. `make` targets changed (README).
- Mail: no SMTP; `MAIL_PROVIDER` is `none`, `webhook` or `http`.

### Added
- **Hardening and QA (Phase M9)**: access tokens are rejected after a password change; `__proto__` bodies no longer crash validation; MongoDB indexes are created in code (seed, daily cron, optional deploy step) with explain-plan tests; `check-floors.mjs` covers every direct dependency; axe on every portal page type in both languages and the contact form's keyboard behaviour (focus moves to the first invalid field); `docs/LIMITS.md` and `docs/SECURITY.md`.
- Measurement script `scripts/measure-api.mjs` and Lighthouse script `web/portal/scripts/lighthouse.mjs`.

### Removed
- `legacy-api/` (Laravel). History: the tag `laravel-v1.0.0`, `docs/PHASES-laravel.md`, `docs/legacy-openapi.json`.

### Known limits
- Password hashing is PBKDF2 at the runtime's 100,000 cap, below current OWASP guidance; whether login fits the Free plan's 10 ms CPU limit is **not measured on a deployed Worker** (SECURITY.md R1, DEPLOY.md Part D).
- Not verified on a deployed site: CPU per request, rate limits on the Worker, Atlas latency, concurrent media commits.
- Lighthouse 90+ budgets and the admin sign-in axe scan have a script and a spec but were not run in this release (docs/LIMITS.md).
- Atlas M0 allows 0.5 GB, 100 operations a second and pauses after 30 days without a connection (the daily cron prevents that).
- The portal's CSP allows only the inline scripts it hashes per page (a `<meta>` CSP built at export); `/admin/*` has no inline script. It was verified in a real browser against the local export, not the deployed site.
- `picomatch` has an unpatched ReDoS advisory in dev tooling only.

## [1.0.0] - 2026-11-13

First release.

### Added
- **API** (Laravel 13, PHP 8.5, MariaDB): sections, services, team, testimonials, gallery, FAQs, blog (categories, posts, sanitised rich text), contact inbox with captcha, honeypot and throttle,
  settings, users, roles and permissions, per-user menus, dashboard, image uploads with WebP variants, content-change webhook, OAuth 2 with PKCE (Passport), OpenAPI export.
- **Admin** (Vite, React 19): sign-in through the authorization-code flow with PKCE, CRUD screens driven by `modules.ts`, TipTap blog editor, profile, role matrix, bilingual fields.
- **Portal** (Next.js 16): Home and section pages, services, gallery, FAQ, blog (categories, pagination), contact page, legal pages, localised 404, two languages, ISR with tag revalidation,
  canonical/hreflang/Open Graph, `sitemap.xml`, `robots.txt`, JSON-LD.
- **Security**: S256-only PKCE, closed CORS, security headers and CSP per vhost, per-visitor throttling, upload validation by content, `make security` (route/policy audit, secrets scan, version floors).
  Findings and scans: docs/SECURITY.md.
- **Quality**: Pest, Larastan, Pint; Vitest; Playwright smoke and axe suites (WCAG 2 A/AA, both languages, zero violations); Lighthouse SEO 100.
- **Production** (`docker-compose.prod.yml`, `.env.prod.example`): portal as a Node server, admin built static and served by nginx, TLS from mounted certificates, only ports 80/443 published,
  private MariaDB, restart policies, healthchecks, rotated logs, uploads path from env. `scripts/backup.sh` and `scripts/restore.sh` (database, uploads, OAuth keys).
- **Docs**: README, DEPLOY, CUSTOMIZE, UPGRADE, ENV, PATTERNS, DECISIONS, SECURITY, SIZING, VERSIONS, PHASES.

### Notes
- Environment variables: see docs/ENV.md and `.env.prod.example`. Seeders: run `php artisan db:seed --force` once on first deploy.
- The database is MariaDB 11.8 and there is no Redis (docs/DECISIONS.md, 010); backups use `mariadb-dump`.
- Known limits: the portal CSP still allows inline scripts (nonces are the next step); Lighthouse performance 90+ was not reached under the default mobile throttle on the slow development host (docs/SECURITY.md).

[2.0.0]: https://github.com/sadrulhossain/gd-business-site-starter/releases/tag/v2.0.0
[1.0.0]: https://github.com/sadrulhossain/gd-business-site-boilerplate/releases/tag/v1.0.0

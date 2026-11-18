# Security

Review of the Cloudflare Workers stack (Express API on a Worker, MongoDB Atlas, static portal and admin, media in the
repository). Written in Phase M9, 2026-11-18, for the code at that commit. Everything below was run locally against
MongoDB 8.0.38 and `wrangler dev` (workerd); items that need the deployed site are listed under **Not verified**.
The earlier Laravel review is in `legacy-api/`'s history (tag `laravel-v1.0.0`) and no longer applies.

Gates you can run any time: `pnpm --filter @gd/api test` (route audit, security, indexes), `node scripts/check-floors.mjs`
(version floors and pinning rules), `sh scripts/check-secrets.sh`, `pnpm audit --prod --audit-level=high`.

## Threat model in one paragraph

Public visitors read static files and call a few public JSON routes (settings, content, captcha, contact form). Staff sign in
at `/admin/` with email and password and receive a 15-minute bearer token plus a host-only refresh cookie. The only secrets
are Worker secrets (`MONGODB_URI`, `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `GITHUB_REPO_TOKEN`, optional mail keys) and
four GitHub Actions secrets. There is no file upload to a server disk: images are validated, then committed to this repository.

## Findings fixed in this phase

| # | Finding | Severity | Fix | Test |
|---|---------|----------|-----|------|
| 1 | After a password change (own or by an admin) the refresh tokens were revoked, but access tokens issued earlier kept working for up to 15 minutes | Medium | the auth middleware rejects a token issued in an earlier second than `password_changed_at` | `security.test.ts`: access tokens after a password change |
| 2 | A JSON body with a `__proto__` key made the validation error collector throw, so the API answered 500 instead of 422 (no prototype pollution happened, but it is an uncaught crash path on every route) | Low | the details map has no prototype in `http/validate.ts` and the contact route | `security.test.ts`: `__proto__` key |
| 3 | When the database was unreachable, the failed connection also surfaced as an unhandled promise rejection (noise in the Worker logs, and it hid the real error) | Low | `openConnection` handles the initial connection promise; the request that needed it still reports the error | `security.test.ts`: database failure |
| 4 | `bcryptjs` and `hash-wasm` were production dependencies although only the unrun spike code imports them | Low | moved to devDependencies; the Worker bundle never contained them | `check-floors.mjs` |
| 5 | Ten installed packages had no row in `docs/VERSIONS.md`, so no floor was checked and CLAUDE.md rule 2 was not enforced | Low | rows added; `check-floors.mjs` now fails on a dependency without a row, a range instead of an exact version, or a pin that differs from the table | `node scripts/check-floors.mjs` |

## Verified, with a test (`api/test/security.test.ts` unless noted)

| Area | What is proved |
|------|----------------|
| Route protection | every route declares public, a permission, or own; the public surface is an exact list of 19 routes; every other route answers 401 without a token; permissions exist in the registry (`routeAudit.test.ts`, unchanged: no allow-list growth) |
| Permissions | 401 before 403; superadmin bypass; only a superadmin may edit or delete a superadmin; nobody can delete themselves; a role may only grant permissions its creator holds (`access.test.ts`, `modules.test.ts`) |
| Refresh tokens | rotation is atomic; re-using a used token revokes the whole family; logout revokes the family; deactivating a user revokes; a password change revokes every token (`auth.test.ts`) |
| Cookie | host-only (`__Host-rt` in production), HttpOnly, Secure, SameSite=Lax, Path=/, no Domain; the token never appears in a body |
| CSRF | `/auth/refresh` and `/logout` need `X-Requested-With: gd-admin` and an Origin from `SITE_ORIGIN` or `CORS_ALLOWED_ORIGINS`; a foreign Origin is 403 |
| CORS | credentials only for exact configured origins; `*` in the setting never produces an allow-origin header; a preflight from an unlisted origin gets no CORS headers (`errors.test.ts` too) |
| Body limits | JSON bodies over 1 MB are 413; multipart is cut at `UPLOADS_MAX_MB` by Content-Length and while streaming |
| Validation | every body schema is `z.strictObject`; unknown keys are 422; query strings are validated and arrays are refused |
| Operator injection | `$ne`, `$gt`, `$regex`, `$where` in login and contact bodies are 422 and never reach a query; `sanitizeFilter` is on, and our own `$in`/`$lt` filters opt in with `mongoose.trusted()`. Express 5 parses `page[$gt]=0` as a literal key, so a query string cannot carry an operator object |
| Mass assignment | `is_active`, `password_hash`, `role_ids`, `_id`, `password_changed_at`, `email` (on `/me`), `permissions` and timestamps are 422 on user, profile and content routes |
| Login errors and timing | unknown email, wrong password and inactive user answer the same 401; locally the median wall time was 1.04 times the same for unknown and wrong (n=8; the unknown path burns an equal PBKDF2 run). Throttled per IP and per email, 10 a minute |
| Uploads | type by magic bytes (never by name or declared type); WebP only for variants, ICO or PNG only for the favicon; SVG, GIF, PDF, ZIP and HTML polyglots are 422; declared pixels capped at 36 million and variant width at 1600; file names are generated on the server (a client name of `../../x` changes nothing); all GitHub calls go to `GITHUB_REPO` only; a failed commit saves no document and returns no GitHub detail (`media.test.ts` too) |
| Commit atomicity | one commit per upload; a failed commit leaves the document without an image; a retry on a moved branch; at most 3 retries |
| HTML | 35 hostile payloads stay inert and 10 allowed samples survive (`sanitize.test.ts`, sanitize-html, ADR 013) |
| Captcha and contact | one use (even for a wrong answer), expiry checked in the query, honeypot answers like success, throttled 5 a minute per IP, captcha 30 a minute (`contact.test.ts`) |
| Errors | unknown routes 404 and wrong methods 405 as JSON; a server error returns `Server error.` only; with a connection string containing a password, neither the response nor the logged error contains it; the only two `console` calls in the API are the reviewed error loggers (`errors.test.ts`) |
| Headers (API) | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store` |
| Headers (site) | `_headers` is assembled and checked on every build (`assemble-site.test.mjs`): the portal CSP never reaches `/admin/*` or `/media/*`; `/admin/*` has `default-src 'self'; script-src 'self'` (no inline script); `/media/*` is `default-src 'none'; sandbox` with `nosniff` |

## Accepted risks (residual)

| # | Risk | Why accepted | What would change it |
|---|------|--------------|----------------------|
| R1 | **Password hashing is PBKDF2-SHA256 at 100,000 iterations** (the workerd cap). OWASP recommends 600,000 for this algorithm, and a stronger hash such as Argon2id does not fit the Free plan's 10 ms CPU limit | WebCrypto PBKDF2 is the only native option on Workers (ADR 016). The login is throttled to 10 a minute per IP and per email, passwords need 12 or more characters, and tokens are short-lived | The deployed measurement in DEPLOY.md Part D (a). If login exceeds the CPU limit on Free, use the Workers Paid plan (30 s CPU) and raise the iteration count in `api/src/auth/password.ts`; hashes are self-describing and are upgraded on the next login |
| R2 | Atlas network access is `0.0.0.0/0` because Workers have no fixed addresses | there is no alternative on Free; protected by TLS, least-privilege users and long passwords | Cloudflare Workers VPC or a paid Atlas tier with private endpoints |
| R3 | The login throttle is also a lock-out lever: someone who knows an email can make that account's login fail for a minute at a time | the legacy behaviour; the other choice (no per-email limit) allows slow guessing | a CAPTCHA step after failures |
| R4 | Rate limits are counters in MongoDB, so each limited request costs a database write | ADR 015; the Cloudflare rate-limit binding is not available to confirm on Free | add the binding as an outer layer after a deployed check |
| R5 | `X-Request-Id` from the client is echoed when it matches `[\w.-]{8,64}` | harmless: it is not used for anything but log correlation | none |
| R6 | An image whose WebP header is valid but whose body is not an image is stored | the file is served with `nosniff` and a `sandbox` CSP as `image/webp`; the browser will not execute it | the admin makes the WebP variants in the browser (ADR 017), so a normal upload is always a real image; a server-side decoder does not fit the CPU limit |
| R7 | A media commit that succeeds but whose document save then fails leaves an orphan file in `media/` | no data is lost and the cost is a few KB; the file count limit is counted from documents, not the repository | a monthly cleanup script if it ever matters |
| R8 | `picomatch` (all versions up to 4.0.7) has a high ReDoS advisory ([GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)) with no patched release; it is reached only through Vite, Vitest and other build tools (`pnpm audit` full run, 2026-11-18) | not in the production tree (`pnpm audit --prod` is clean); the patterns come from our own config, never from a request | upgrade when a fixed version exists; `ci.yml` audits production dependencies at high |
| R9 | The GitHub token is stored as a Worker secret and can write to `main` | scoped to this repository, Contents and Actions only, with an expiry; it cannot reach any other repository (all calls use `GITHUB_REPO`) | a GitHub App with narrower permissions |
| R10 | Backups of a public repository's artifacts are readable by anyone, so only the AES-256 file is uploaded | the passphrase is a GitHub secret; PBKDF2 key derivation | a private repository |

## Dependencies

Run 2026-11-18. `pnpm audit --prod`: **no known vulnerabilities**. `pnpm audit` (all dependencies): one high, R8 above.
`node scripts/check-floors.mjs`: 44 versions at or above their floor, 39 direct dependencies each with a table row, an exact
pin and a pin that matches the table. `node scripts/check-floors.mjs --upstream`: all 41 distinct pinned npm versions still
exist on the npm registry. Images: `mongo:8.0.38` (CI and backups), `node:24.22.3`, `rhysd/actionlint:1.7.12` (dev tool).
The new dependencies since the last review (express 5.3.0, mongoose 9.12.2, mongodb 7.8.0, zod 4.6.7, jose 6.2.17,
sanitize-html 2.18.2, @asteasolutions/zod-to-openapi 9.1.0, wrangler 4.164.0) were each checked against the advisory
database when they were added (VERSIONS.md) and by the audits above.

Supply chain: pnpm 12 checks the lockfile against its supply-chain policy on install (`minimumReleaseAge`); GitHub
Actions are pinned to commit SHAs; the deploy uses the workspace's wrangler, not a third-party action.

## Accessibility and performance gates

See `docs/LIMITS.md` for measured numbers. axe (WCAG 2.0 and 2.1, A and AA) covers every portal page type in both languages and
the admin sign-in page; the contact form has keyboard, label, error-link and focus tests (`web/portal/e2e/quality.spec.ts`).

## Not verified (needs the deployed site)

- Rate limiting on the Worker (burst, 429, `Retry-After`) was exercised locally by `scripts/measure-api.mjs`; run it against the site (DEPLOY.md Part D).
- Real CPU time per request on Cloudflare's Free plan (the local figures are workerd on a development machine).
- Atlas latency and region, concurrent media commits against GitHub, and the `/admin/*` fallback on a real deployment.
- The CSP in a real browser against the deployed site (it was verified against the static export served locally).

# Free-tier limits

Every limit this site depends on, with its source, the date it was read, what this site uses today and what to do at 80 percent.
Checked 2026-11-18. Plans change: re-read the sources before you rely on a number for a decision. "Used" figures are from the
local build and local measurements of the repository at the Phase M9 commit unless the column says deployed; the deployed column is
filled in by running the steps in `docs/DEPLOY.md`, Part D (`scripts/measure-api.mjs` prints the numbers).

## Cloudflare Workers (Free)

| Limit | Value | Used | At 80 percent | Source |
|-------|-------|------|---------------|--------|
| Requests per day | 100,000 (resets 00:00 UTC) | the portal is static assets (not counted as Worker requests); only `/api/*` and `/admin/*` run the Worker. A visit to the portal makes no API call except the contact form | watch Observability; a bot flood is the risk. Turn on Cloudflare's security level or move to Paid (10 million a month included) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| CPU time per request | 10 ms | see "CPU and wall time" below; **login is the endpoint at risk** (PBKDF2) | Paid plan (30 s) removes the CPU error; a stronger hash needs WASM Argon2id or a Node host (SECURITY.md R1) | same |
| Subrequests per request | 50 | an upload makes about 8 GitHub calls and 1 to 5 database operations; a list makes 2 to 4 database operations | none needed; the media commit retries at most 3 times | same |
| Cron triggers per account | 5 | 2 | keep the schedule at two entries | same |
| Static asset files per version | 20,000 | `check-assets.mjs` prints it on each build (the portal export plus admin plus media) | at 16,000 the build fails; prune media or split | same |
| Static asset file size | 25 MiB | images are at most 5 MB each (`UPLOADS_MAX_MB`) | build fails at 20 MiB | same |
| Worker size | 64 MiB uncompressed on both plans; no compressed limit | 5.7 MB raw (1.0 MB gzipped), see "Bundle" | none expected; re-check after adding a dependency | same |

## MongoDB Atlas (M0)

| Limit | Value | Used | At 80 percent | Source |
|-------|-------|------|---------------|--------|
| Storage | 0.5 GB (data and indexes) | seeded demo database is a few MB; contact messages are the only unbounded collection (5,000 characters each) | delete read messages older than a year in the admin; or upgrade to M2 | [Atlas free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) |
| Operations per second | 100, read and write combined; over the limit Atlas throttles and delays | see "Operations" below | cache is the portal itself (static); only the admin and the contact form write; keep the 15-minute cron cheap | same |
| Connections | 500 | every API request opens its own connection (pool of at most 2) and closes it afterwards, so 250 requests in flight at once would reach it | the 100,000-requests-a-day limit comes first | same |
| Data transfer | 10 GB in and 10 GB out per rolling 7 days | a few MB a day | none expected | same |
| Pause | after 30 days with no connection | the daily cron connects every day | do not remove the cron; if the cluster pauses, resume it in Atlas | same |
| Backups | daily snapshots can be enabled on M0 (four kept) | the repository's weekly encrypted dump is separate | restore test: DEPLOY.md | same |
| Sort in memory | 32 MB | every list query is index-ordered (`indexes.test.ts`) | n/a | same |

## GitHub (the repository and Actions)

| Limit | Value | Used | At 80 percent | Source |
|-------|-------|------|---------------|--------|
| Actions minutes | free for standard runners in a **public** repository; a private repository on Free gets 12 USD of compute a month (about 2,000 Linux minutes) | a deploy takes roughly 4 to 8 minutes; at most one an hour because of the debounce (and the admin's Publish button) | keep the repository public, or lower `PUBLISH_DEBOUNCE_MINUTES` usage; watch Settings, Billing | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Artifact and package storage | 500 MB (Free plan) | one encrypted backup a week; each is the size of the database (a few MB) kept 90 days | 13 backups of 40 MB would reach it; shorten `retention-days` in `backup.yml` | same, and [Actions limits](https://docs.github.com/en/actions/reference/limits) |
| Job time | 6 hours per job | under 30 minutes (`timeout-minutes: 30`) | n/a | [Actions limits](https://docs.github.com/en/actions/reference/limits) |
| Concurrent jobs | 20 on Free | 1 (the deploy waits for a running deploy) | n/a | same |
| REST API, personal token | 5,000 requests an hour; at most 80 content-creating requests a minute and 500 an hour | an upload makes about 8 content requests; a dispatch makes 1 | 400 uploads an hour is not a realistic admin | [REST API limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| Repository size | 10 GB recommended; a file over 100 MB is refused; one push at most 2 GB; 1 MB per file is recommended (images exceed it by design) | `media/` is capped at 6,000 files by `MEDIA_MAX_FILES`; `check-assets.mjs` warns at 500 MB | at 500 MB of media, move images to object storage (a new decision) | [Repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits) |
| Pushes | at most about 6 a minute recommended | one commit per upload, one per delete | an import of many images should be one batch | same |

## `_headers` and `_redirects` (Cloudflare static assets)

| Limit | Value | Used | At 80 percent | Source |
|-------|-------|------|---------------|--------|
| Header rules | 100 | printed by `assemble-site.mjs` (about 8 for an empty site, one per top-level portal path) | the build fails at 80 | [Headers](https://developers.cloudflare.com/workers/static-assets/headers/) |
| Header line length | 2,000 characters | the portal CSP is split between a header and a per-page meta tag (ADR 020) for this reason | the build fails at 1,600 | same |
| Redirects | 2,000 static and 100 dynamic; 1,000 characters each | 2 | the build fails at 80 percent | [Redirects](https://developers.cloudflare.com/workers/static-assets/redirects/) |

## Measured: CPU, wall time and operations

Local, on a development machine (Docker Desktop, 4 shared cores, MongoDB in a container, `wrangler dev` = workerd). This is a baseline
for comparing endpoints with each other and for finding anything that is slow; it is **not** Cloudflare's CPU metric, and it must be
repeated on the deployed site: `MEASURE_EMAIL=... MEASURE_PASSWORD=... node scripts/measure-api.mjs https://<your-site>`.

Run 2026-11-18, one client, requests in series, idle workerd CPU (16 ms a second) subtracted.

| Scenario | n | Wall p50 | Wall p99 | CPU per request (avg) |
|----------|---|----------|----------|-----------------------|
| health (one database ping) | 40 | 42 ms | 150 ms | 56 ms |
| public settings | 40 | 109 ms | 1,615 ms | 219 ms |
| public sections | 40 | 66 ms | 171 ms | 69 ms |
| public posts, page 1 | 40 | 110 ms | 288 ms | 113 ms |
| captcha | 25 | 74 ms | 184 ms | 98 ms |
| login (PBKDF2 check) | 18 | 271 ms | 1,104 ms | 438 ms |
| admin list: users | 40 | 83 ms | 790 ms | 153 ms |
| admin list: contact messages | 40 | 53 ms | 92 ms | 55 ms |
| me (token check and aggregate) | 40 | 55 ms | 142 ms | 66 ms |

First request after start (cold): 1.5 s. Rate limits, one IP: the 11th login in a minute and the 6th contact post got **429 with Retry-After** (limits 10 and 5 a minute).

How to read this honestly:

- The CPU column is the CPU of all workerd processes in the container divided by the number of requests. In `wrangler dev` it includes
  a new MongoDB connection (TCP, handshake, authentication) per request, dev-mode instrumentation and shared Docker CPUs, so it is
  **far above** what Cloudflare bills as "CPU time" (which excludes time waiting on the network). Do not read "56 ms" as "5 times over the limit".
  The values are useful only as a ranking: **login is the heaviest endpoint by a wide margin** (about 380 ms more than a plain read, which is the
  PBKDF2 run), settings had one slow outlier, and everything else is a single query plus connection setup.
- The 10 ms limit therefore **cannot be confirmed or refuted locally**. It is the first thing to check after the first deploy
  (DEPLOY.md Part D): Cloudflare dashboard, Workers, the Worker, Metrics, CPU time p50 and p99, after running `measure-api.mjs` against the site.
  If login p99 is over 10 ms the Free plan will return error 1102 for logins; the decision is R1 in SECURITY.md.
- Operations against the 100 a second Atlas limit: a public read is 1 to 3 operations, a login is about 6 (user, throttle counters, token insert),
  an admin list is 2 (count and page). One person in the admin does well under 5 operations a second; the limit is reached only by an attack
  that gets past the throttles, and then Atlas slows requests down instead of failing them.
- The portal itself makes no API calls (it is static), so visitor traffic does not touch Atlas; only the contact form (3 operations: captcha check, insert,
  throttle) and the daily and 15-minute cron do.
- Indexes: every list and lookup query uses an index (explain plans are asserted in `api/test/indexes.test.ts`). The only intentional scan is
  `users.updateMany` by `role_ids` on a collection of a handful of admins.

## Bundle

`wrangler deploy --dry-run` on 2026-11-18: `worker.js` 5.69 MB raw, 1.02 MB gzipped (about 9 percent of the 64 MiB limit). Re-check with the same command after adding a dependency; the deploy prints the real "Total Upload" and gzip size.

## Frontend gates (Phase M9, 2026-11-18, local, static export served like Cloudflare)

| Gate | Result |
|------|--------|
| axe WCAG 2.0/2.1 A and AA | 16 page types, each in English and Bengali (32 pages) (home, about, services list and detail, pricing, faq, gallery, showcase, blog list, page 2, category, post, contact, privacy, terms, 404): **0 violations** after two fixes (the post page's category and back links were told apart from text by colour only; they are now underlined) |
| Contact form, keyboard and screen reader | labels on every field, the captcha question inside its label, Tab order name, email, phone, subject, message, captcha, button (honeypot skipped), errors linked by `aria-describedby`, an alert announces the failure, and **focus now moves to the first invalid field** (it did not before; fixed in `ContactForm.tsx`) |
| CSP in a real browser | every page runs under its CSP with no violation and no request to another origin (`smoke.spec.ts`, Chromium) |
| Mixed content | no http request or http link on the checked pages (`quality.spec.ts`) |
| canonical, hreflang, Open Graph, Twitter card, JSON-LD | agree on the final URLs, both languages; the home page has a LocalBusiness, a post an Article |

**Not run in this phase (the machine was out of memory):** Lighthouse CI against `out/` with the 90 budgets, and the axe scan of the admin
sign-in page (`web/admin/e2e/a11y-login.spec.ts`, written, needs `make up`). Both are one command each:

```
docker run --rm --ipc=host -v "$PWD:/app" -w /app/web/portal mcr.microsoft.com/playwright:v1.65.0-noble node scripts/lighthouse.mjs
cd web/admin && pnpm exec playwright test   # with the dev stack running
```

The last measured Lighthouse numbers (Phase 15, Next server, default mobile throttling on a slow host) were performance 73 to 86, accessibility and SEO 100. A static
export has less script to run than that build did, but the 90 performance budget is **not yet demonstrated**; run the command above before launch.

## Resilience

| Scenario | Result |
|----------|--------|
| API down | the portal and its pages are static files, so they keep serving; the e2e suite runs with no API at all and only the contact form needs it (it shows the error message). The admin shows its sign-in error |
| API unreachable during a portal build | `api.ts` retries, then throws "Build stopped ... Nothing was published"; `deploy.yml` builds before it deploys, so the job fails and the previous deployment stays live. By code reading and the workflow order; not exercised against a real deploy |
| Backup restore into a scratch database | local MongoDB 8.0.38, demo-sized data (11 KB archive): dump 2.1 s, restore 3.7 s, all 19 collection counts identical and the users indexes identical (the other collections' indexes were not compared). Restore time grows with data; Atlas M0 is capped at 0.5 GB, so a full restore is minutes. The encrypted weekly artifact restore (decrypt then `mongorestore`) is in DEPLOY.md and is not run here |

# Upgrade

Two kinds of upgrade: **your site to a newer release of this starter**, and **the pinned software** (Node, Next, wrangler, Mongoose and the rest).
Both end the same way: tests green, a deploy, and a look at the site. A bad deploy is undone with a rollback (DEPLOY.md, "Rollback").

## Before every upgrade

1. Read [CHANGELOG.md](../CHANGELOG.md) from your current version to the new one: new variables, new secrets, new seed steps, and breaking changes are listed there.
2. Run the backup workflow once (Actions, **backup**) and keep the artifact; know your rollback target (the current tag and the current Worker version).
3. Compare `.env.example` and `docs/ENV.md` with your `.env`, and `wrangler.jsonc` vars with the new ones (`git diff vOLD vNEW -- .env.example docs/ENV.md wrangler.jsonc`).

## Upgrade the site to a new release

```sh
git remote add upstream <the starter's URL>     # once
git fetch upstream --tags
git merge vNEW                                  # resolve conflicts in files you customized
make up && make check                           # tests, versions, parity, security
git push                                        # CI runs; the deploy workflow publishes
```

New indexes are created by the next daily cron, by `make seed-core`, or at deploy time if you set the optional `INDEXES_MONGODB_URI` secret (DEPLOY.md). A release that
adds a seed step says so in the changelog: run `make seed-core` against production through `pnpm --filter @gd/api seed` with `MONGODB_URI` set (it only creates what is missing).

## Bump the pinned software

Every pin lives in `docs/VERSIONS.md` (the pin, the floor below which we never go, the source and the date), in the pnpm catalog (`pnpm-workspace.yaml`) or in `.env`
(`*_VERSION` for Docker images). `node scripts/check-floors.mjs` fails when a lockfile or direct dependency is below its floor, is a range instead of an exact version, or differs from the table.

1. Read the release notes and the advisories for the new version. Look for a security release first.
2. Change the pin in one place (catalog or `.env`), update the row in `docs/VERSIONS.md` (pin, floor if it rose, source, date), run `pnpm install` in the dev container.
3. `node scripts/check-floors.mjs --upstream` (also asks npm that every pinned version exists), `pnpm audit --prod --audit-level=high`, then `make check`.
4. Run the browser suite (README) when Next, React, Tailwind or the admin libraries change.

Specific cases:

| Component | Care |
|-----------|------|
| **wrangler and `compatibility_date`** | `wrangler` is a pinned dev dependency, not a global. After a bump run `wrangler dev` (via `make up`) and the API tests, then deploy. `compatibility_date` in `wrangler.jsonc` selects runtime behaviour: move it forward only after reading the Workers compatibility-date changelog for the dates in between, and keep `nodejs_compat`. Test login and an image upload after changing it, because they use WebCrypto and `node:` modules. |
| **Mongoose and the MongoDB driver** | Bump together (the driver is a Mongoose dependency; the pins are checked). A major version can change `sanitizeFilter`, query casting and index options: run `api/test/security.test.ts` and `api/test/indexes.test.ts`, which assert operator injection is refused and explain plans use indexes. Check the server version too: `MONGO_VERSION` is the dev and CI image; Atlas M0 runs whatever Atlas offers. |
| **Next.js** | The portal is a static export. After a bump build it (`web/portal/scripts/e2e.mjs`, README) and look at the axe and CSP tests: inline scripts and hashes change between versions and the CSP is length-limited (`scripts/assemble-site.mjs` fails the build if a header line is too long). |
| **Node image** | `NODE_VERSION` changes the dev and CI container only; the Worker runs workerd. Take security releases of Node promptly all the same (the build tooling runs on it). |
| **pnpm** | `packageManager` in the root `package.json`; the lockfile policy checks (`minimumReleaseAge`) belong to pnpm. |

## When a free-tier limit changes

`docs/LIMITS.md` lists each limit with its source and the date it was read. When a vendor changes one:

1. Update the row (value, date, source) and the "at 80 percent" action.
2. Check the guardrails that encode it: `scripts/check-assets.mjs` (file count and size), `scripts/assemble-site.mjs` (`_headers` rules and line length), `MEDIA_MAX_FILES` and `UPLOADS_MAX_MB`
   in `wrangler.jsonc`, the cron schedule, `PUBLISH_DEBOUNCE_MINUTES`.
3. If a limit got tighter than the site fits, decide before it bites: smaller limits in those guardrails, or one of the moves below.

## Move to the paid Workers plan

Nothing in the code changes: the plan is an account setting. It lifts the CPU limit from 10 ms to 30 s (default; up to 5 minutes), removes the 100,000 requests a day cap and raises the subrequest, cron-trigger and
static-asset-file limits (docs/LIMITS.md, Cloudflare's limits page). Do it when the deployed measurement (DEPLOY.md, Part D) shows login or an admin call exceeding the 10 ms CPU limit (Cloudflare error 1102).
It does **not** raise the PBKDF2 iteration cap (100,000, inside workerd), so password strength stays as in SECURITY.md R1; for that see the next section.

## Move to a Node host (or a stronger password hash)

Use this if the CPU limit cannot be met, or you want Argon2id or more PBKDF2 iterations. The API is plain Express (`api/src/app.ts` exports `createApp(env)`), so the move is small:

1. Add an entry file that builds the app from `process.env` and calls `listen(PORT)` (the Worker entry `api/src/worker.ts` does the same with Worker bindings and `httpServerHandler`).
2. `api/src/db.ts` opens a connection per request because Workers cannot keep one; on a Node host replace it with one shared connection.
3. The cron work (`api/src/scheduled.ts`: publish pipeline every 15 minutes, daily cleanup and indexes) needs a scheduler on the host, calling the same functions.
4. Password hashing: `api/src/auth/password.ts` is self-describing (`$pbkdf2-sha256$i=...`). Add the new algorithm and raise the target; `needsRehash` upgrades each user's hash at their next login.
5. The portal and admin stay static, so keep serving them from Cloudflare (or any static host) and point `/api/*` at the new host; `SITE_ORIGIN`, `CORS_ALLOWED_ORIGINS` and the cookie settings must match
   the new origins (the refresh cookie is host-only, so the API must stay on the same host name as the admin, or you change the cookie design in `docs/DECISIONS.md` ADR 016).
6. Media still commits to the repository through the GitHub API; nothing changes there.

This is a design change, not a switch: write it down as a new ADR in `docs/DECISIONS.md` first.

# Deploy to Cloudflare

One Worker, one origin, no server. Everything runs on free plans: Cloudflare Workers (Free), MongoDB Atlas (M0) and GitHub Actions.

| URL path | Served by |
|----------|-----------|
| `/` (portal), `/media/*`, `/admin/assets/*` | static assets, no Worker run |
| `/admin/*` | Worker: the file if it exists, else the admin app (`api/src/assets.ts`) |
| `/api/*` | Worker: Express API on MongoDB Atlas |

The Worker is named `gd-business-site-starter` (root `wrangler.jsonc`). Its address is `https://gd-business-site-starter.<your-subdomain>.workers.dev`. The development config `api/wrangler.jsonc` is a different Worker name and is never deployed.

**What I could not verify.** Phase M1 spikes a, e, g and h (password hashing CPU, Atlas latency, GitHub media commits, single-origin routing) were skipped by decision; see `docs/SPIKES.md`. Part D tests each one on the real deployment, with a fallback if it fails. Do not announce the site before Part D passes.

## Manual steps you must do

You do these by hand because they need your logins and tokens. Nothing in this repository can deploy before step 10, because the workflows need your secrets.

### Part A: accounts and tokens

- [ ] **1. Cloudflare account and workers.dev subdomain.** Sign up at dash.cloudflare.com (free). Open **Workers & Pages**; the first visit asks you to choose a subdomain (`<name>.workers.dev`). Your site will be `https://gd-business-site-starter.<name>.workers.dev`. If `<name>` is not `hossainsadrul`, edit `vars.SITE_ORIGIN` in `wrangler.jsonc` and commit it (the build and the cookie origin read it).
- [ ] **2. Cloudflare account ID.** In the dashboard, open Workers & Pages; the **Account ID** is on the right side (also in the URL after `dash.cloudflare.com/`). Copy it for step 6.
- [ ] **3. Atlas cluster.** At cloud.mongodb.com create a project and a **free M0** cluster. Region: the one nearest your visitors and Cloudflare's edge (an Atlas region in the same area as most visitors; Workers run near the visitor, so a far region adds latency to every API call). The M1 latency spike never ran, so Part D measures it. Name the database `gd-business-site-starter` (it appears when first written; it must match `vars.MONGODB_DB`).
- [ ] **4. Two Atlas database users** (Database Access, Add New Database User, password authentication, long random passwords, avoid `@ : /` or URL-encode them):
  - `gd-business-site-starter-app`: **readWrite on `gd-business-site-starter` only** (Specific Privileges; remove "Read and write to any database").
  - `gd-business-site-starter-backup`: **read on `gd-business-site-starter` only**.
- [ ] **5. Atlas network access.** Network Access, Add IP Address, **Allow access from anywhere (0.0.0.0/0)**. Workers have no fixed addresses, so an allow-list cannot work. The risk: anyone who has the connection string and password can connect from anywhere. Mitigations in place: TLS only (Atlas default), strong passwords, least-privilege users (the backup user cannot write; neither user can touch other databases), and you rotate the string if it leaks.
  Then build the two connection strings (Connect, Drivers, Node.js) and add the database name and a short server selection timeout:
  ```
  mongodb+srv://gd-business-site-starter-app:<password>@<cluster>.mongodb.net/gd-business-site-starter?retryWrites=true&w=majority&serverSelectionTimeoutMS=5000
  mongodb+srv://gd-business-site-starter-backup:<password>@<cluster>.mongodb.net/gd-business-site-starter?retryWrites=true&w=majority&serverSelectionTimeoutMS=5000
  ```
  Never paste these anywhere but the prompts below. **Limits to know** ([source](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), read 2026-11-18): M0 stores 0.5 GB (data and indexes), allows 100 operations a second, 500 connections and 10 GB of data transfer in and out per rolling week, and **pauses after 30 days with no connection** (the daily cron prevents that; do not disable it). Atlas can take daily snapshots on M0 and keep four: switch them on under Backup in Atlas, but the weekly encrypted dump of this repository (`backup.yml`) is the backup you control and have restored.
- [ ] **6. GitHub repository secrets.** Repository, Settings, Secrets and variables, Actions, New repository secret:

  | Secret | Value |
  |--------|-------|
  | `CLOUDFLARE_API_TOKEN` | the token from step 7 |
  | `CLOUDFLARE_ACCOUNT_ID` | step 2 |
  | `BACKUP_MONGODB_URI` | the **read-only** string from step 5 |
  | `BACKUP_PASSPHRASE` | 32 or more random characters (`openssl rand -base64 36`); store a copy in your password manager, because a backup cannot be read without it |

  Optional: `INDEXES_MONGODB_URI`, the **readWrite** string again. With it, every deploy first runs `pnpm --filter @gd/api indexes` (creates any index a new release added, before the new code goes live). Without it nothing breaks: the seed command and the daily cron create indexes too, so a new index exists within a day. The reason it is optional: it puts a write-capable database credential in GitHub.

  There is no GitHub variable to set: the deploy reads `SITE_ORIGIN` and `LOCALE_*` from `wrangler.jsonc`.
- [ ] **7. Cloudflare API token for the deploy.** Dashboard, Manage Account, Account API tokens, Create Token, **Edit Cloudflare Workers** template ([GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)). Under Account Resources choose **only this account**. Remove any zone permission and zone resource (a zone scope is needed only if you add a custom domain later). The deploy needs Workers Scripts: Edit; I could not confirm the exact list of scope names from the docs, so if the first deploy fails with an authentication error naming a permission, add exactly that one. Set an expiry and note the date. Copy the token once; it is not shown again.
- [ ] **8. The API's GitHub token (`GITHUB_REPO_TOKEN`).** The Worker uses it to commit uploaded images and to start the build. GitHub, Settings, Developer settings, Personal access tokens, **Fine-grained tokens**, Generate new token:
  - Repository access: **Only select repositories**, this repository.
  - Permissions: **Contents: Read and write** and **Actions: Read and write**. Nothing else.
  - Expiration: 90 days or less. Put the expiry in your calendar; when it lapses, uploads and publishing stop with 503/502 (rotation below).
  - **Branch rule:** images are committed straight to `main` (`MEDIA_GIT_BRANCH` and `GITHUB_REF` are both `main`), so `main` must accept pushes from this token. Do not enable branch protection that requires pull requests on `main`, and do not rely on the token bypassing a rule (a fine-grained token cannot).
  This token is a Worker secret (step 12), not a GitHub Actions secret.
- [ ] **9. Local tools.** Node 24.22.3 and pnpm 12.18.0 (`corepack enable`), then `pnpm install` in the repository root. Log in once: `cd api && pnpm exec wrangler login`.

### Part B: first deployment

- [ ] **10. Merge this work to `main`.** The push starts `deploy.yml` once. **It will fail at the portal build** ("cannot reach the API"), because the API does not exist yet. That is expected and harmless: a failed build deploys nothing.
- [ ] **11. Bootstrap deploy.** GitHub, Actions, **deploy**, Run workflow, ref `main`, tick **bootstrap**. It deploys the admin and a placeholder page, so the Worker and the API exist. The health check step may show a warning (no secrets yet); that is fine.
- [ ] **12. Set the Worker secrets**, from `api/`. Each command asks for the value; paste it at the prompt (never on the command line):
  ```
  cd api
  pnpm exec wrangler secret put MONGODB_URI -c ../wrangler.jsonc          # step 5, the readWrite string
  pnpm exec wrangler secret put JWT_ACCESS_SECRET -c ../wrangler.jsonc    # openssl rand -base64 48
  pnpm exec wrangler secret put REFRESH_TOKEN_PEPPER -c ../wrangler.jsonc # openssl rand -base64 48, a different value
  pnpm exec wrangler secret put GITHUB_REPO_TOKEN -c ../wrangler.jsonc    # step 8
  ```
  Always pass `-c ../wrangler.jsonc`; without it wrangler uses the development config and a different Worker. Optional, only if you set `MAIL_PROVIDER`: `MAIL_API_KEY` (provider `http`) or `NOTIFY_WEBHOOK_URL` (provider `webhook`; also set `MAIL_PROVIDER` in `wrangler.jsonc`). Changing a secret takes effect at once; no redeploy.
- [ ] **13. Health.** Open `https://gd-business-site-starter.<name>.workers.dev/api/v1/health`. Expected: `{"status":"ok","database":"ok"}`. If it says `degraded`, the Atlas string or the network access (step 5) is wrong.
- [ ] **14. Seed the database** from your computer (not in CI). Core data (roles, menus, your superadmin) without demo content:
  ```
  MONGODB_URI='<the readWrite string>' SUPERADMIN_NAME='Your Name' SUPERADMIN_EMAIL='you@example.com' SUPERADMIN_PASSWORD='<12+ characters>' pnpm --filter @gd/api seed
  ```
  Add `-- --demo` to the command for sample content. It is safe to run again: it never overwrites edits or resets an existing password.
- [ ] **15. Sign in** at `https://gd-business-site-starter.<name>.workers.dev/admin/` with that email and password, then change the password. Fill in Settings and your content.
- [ ] **16. First portal build.** Actions, **deploy**, Run workflow, ref `main`, **bootstrap unticked**. The job reads the live API, builds the portal, assembles `dist/site`, deploys, and checks health. Open `/`.
- [ ] **17. Check the first run's numbers.** The log line `check-assets: N files of 20000, media X MB` should be far below the limits.

### Part C: first backup

- [ ] **18. Run the backup once.** Actions, **backup**, Run workflow. Download the artifact `backup-<date>` (a file named `dump.archive.enc`) and try the restore below into a scratch database. A backup you have never restored is not a backup.

### Part D: verify the four untested assumptions

Do all four before you consider the site live.

- [ ] **a. Password hashing fits the free CPU limit** (ADR 016, PBKDF2 at 100,000 iterations, 10 ms CPU per request on the Free plan). In one terminal run `cd api && pnpm exec wrangler tail gd-business-site-starter -c ../wrangler.jsonc --format json`; in the admin, sign out and in 10 times. **Pass:** every `/api/v1/auth/login` shows `outcome: ok`. **Fail:** `exceededCpu` or Cloudflare error 1102 on login. Fallbacks, in order: Workers Paid plan (about 5 USD a month, 30 s CPU, no code change); or an algorithm change in `api/src/auth/password.ts` (hashes are self-describing, so no migration), which needs a new decision record. Do not lower the iteration count without recording it.
- [ ] **e. Atlas latency and region.** `for i in $(seq 20); do curl -s -o /dev/null -w '%{time_total}\n' https://gd-business-site-starter.<name>.workers.dev/api/v1/health; done`. **Pass:** typically under 0.5 s. **Fail:** consistently above 1 s: create the cluster again in a region closer to your visitors (M0 cannot move), change `MONGODB_URI`, and seed again. The daily Atlas ping and the 5 s `serverSelectionTimeoutMS` keep a cold start from hanging.
- [ ] **g. Media commits through the GitHub API.** In the admin, upload two images at the same time (two browser tabs). **Pass:** both succeed, `media/` on `main` gains both files in the GitHub history, and the Actions tab shows **no** build from those commits (`media/**` is ignored) until the quiet period passes, then exactly one. **Fail:** 503 means the token or `GITHUB_REPO` is wrong; 409/422 on simultaneous uploads means the commit code needs a retry (report it with the response text).
- [ ] **h. Single-origin routing.** Run these against your address (`H=https://gd-business-site-starter.<name>.workers.dev`):
  ```
  curl -sI $H/                          # 200 text/html, portal CSP, short cache
  curl -sI $H/admin/                    # 200, admin CSP, Cache-Control: no-cache
  curl -sI $H/admin/users/42            # 200, the admin app (fallback), Cache-Control: no-cache
  curl -sI $H/admin/assets/<a file>     # 200, immutable; copy a name from view-source of /admin/
  curl -s  $H/api/v1/health             # JSON
  curl -sI $H/media/<an uploaded file>  # 200, immutable
  curl -sI $H/does-not-exist            # 404, the portal's 404 page
  curl -sI $H/en/                       # 301 to /  (only if the portal has /en/*)
  ```
  Then reload `/admin/users/42` in the browser (it must open the app, not a 404). In the Cloudflare dashboard, Workers & Pages, gd-business-site-starter, Observability, only `/api/*` and `/admin/*` (except `/admin/assets/*`) should appear. **Fail:** if `/admin/users/42` returns the portal 404, the admin fallback is not running; check `run_worker_first` in the deployed config (dashboard, gd-business-site-starter, Settings, Runtime) and that `assets.binding` is `ASSETS`. If `_headers` rules show up wrong on the fallback response, report the exact response headers.

## Everyday operation

A content change in the admin marks the site dirty; a cron every 15 minutes starts the **deploy** workflow after a quiet period of 2 minutes (at most one build per 5 minutes). The admin's **Publish** button starts it at once. A commit to `main` also deploys, except changes limited to `media/**`, `docs/**` and Markdown files.

**Logs.** `cd api && pnpm exec wrangler tail gd-business-site-starter -c ../wrangler.jsonc`. Cloudflare keeps request logs in the dashboard (Observability) on the Free plan for a short time only.

**Health.** `GET /api/v1/health`.

**Cloudflare Free limits** to keep in mind (to be listed in `docs/LIMITS.md`, M9): 100,000 requests a day, 10 ms CPU per request, 50 subrequests per request, 20,000 files per deployment, 25 MiB per file, 5 cron triggers per account (this site uses 2). Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), read 2026-11-18.

## Rollback

| Situation | Do this |
|-----------|---------|
| A bad deployment (broken page or admin) | `cd api && pnpm exec wrangler rollback -c ../wrangler.jsonc` (add a version ID to pick one; `pnpm exec wrangler deployments list -c ../wrangler.jsonc` lists them). It restores code and assets instantly. It does **not** undo database changes, and secrets stay as they are. |
| Rebuild an earlier version | Actions, an earlier **deploy** run, **Re-run all jobs**. This rebuilds that commit's code, but the portal reads the **current** content from the API. |
| A bad image upload | `git revert <media commit>` on `main`, push, then run **deploy** by hand (a media-only push does not build). |
| A bad content change | Fix it in the admin and press **Publish**. |
| Data lost or damaged | Restore below. |

## Restore from a backup

1. Actions, **backup**, a run, download the artifact (a zip containing `dump.archive.enc`) and unzip it.
2. Decrypt: `openssl enc -d -aes-256-cbc -pbkdf2 -in dump.archive.enc -out dump.archive -pass pass:'<BACKUP_PASSPHRASE>'`
3. Restore **into a scratch database first**, with a user that may write (the app user):
   `docker run --rm -v "$PWD:/b" mongo:8.0.38 mongorestore --uri '<readWrite URI>' --gzip --archive=/b/dump.archive --nsFrom 'gd-business-site-starter.*' --nsTo 'gd-business-site-starter_restore.*'`
4. Compare in Atlas (Browse Collections): collection names and document counts of `gd-business-site-starter_restore` against `gd-business-site-starter`.
5. To restore production: drop the damaged collections (or the database) in Atlas, then run the same command with `--nsFrom 'gd-business-site-starter.*' --nsTo 'gd-business-site-starter.*'`. Run the seed afterwards only if the roles or menus are missing. Delete `gd-business-site-starter_restore` and the decrypted `dump.archive` when done.
Backups hold your users' contact messages and password hashes. Treat the passphrase and the decrypted file as secrets.

## When the portal build fails

The deploy stops before the deploy step, so the previous site stays live. Read the failing step:
1. **Cannot read the API** (`BUILD_API_URL`): open `/api/v1/health`. `degraded` or an error page: Atlas paused (resume it in Atlas; the daily cron should prevent this), network access removed, `MONGODB_URI` secret wrong or the database user's password changed, or the daily 100,000-request limit reached (resets at 00:00 UTC).
2. **Worker not found / 404 on the API:** the Worker was never deployed; run the bootstrap deploy (step 11).
3. **`wrangler deploy` authentication error:** `CLOUDFLARE_API_TOKEN` expired or missing a permission (step 7).
4. **`check-assets` or `assemble-site` failure:** it prints the file or rule that is over 80 percent of a limit; fix the content or the rule.
5. A TypeScript or unit-test failure: fix it in a pull request; `ci` shows the same failure.

## Rotating secrets

| Secret | How |
|--------|-----|
| `JWT_ACCESS_SECRET` | `wrangler secret put`; everyone is signed out within 15 minutes. |
| `REFRESH_TOKEN_PEPPER` | Rotate only together with a forced sign-out: the old refresh tokens stop working at once. |
| Atlas password | Change it in Atlas, update the Worker secret `MONGODB_URI` and the GitHub secret `BACKUP_MONGODB_URI` (they are two users). |
| `GITHUB_REPO_TOKEN` | Create a new fine-grained token (step 8), `wrangler secret put GITHUB_REPO_TOKEN`, then delete the old one in GitHub. Do it before the expiry date. |
| `CLOUDFLARE_API_TOKEN` | Create a new token (step 7), update the GitHub secret, delete the old one. |
| `BACKUP_PASSPHRASE` | Old backups need the old passphrase; keep it until those backups expire (90 days). |

## Optional: custom domain (steps only)

1. Add the domain to Cloudflare (DNS zone) and point the registrar's name servers at Cloudflare.
2. In `wrangler.jsonc` add `"routes": [{ "pattern": "example.com", "custom_domain": true }]` and set `vars.SITE_ORIGIN` to `https://example.com`. (The portal's canonical URLs and the sitemap use `SITE_ORIGIN` through the build.)
3. Add a zone permission to the API token (step 7), limited to that one zone, because `wrangler deploy` now manages the route.
4. Commit and deploy (`deploy` workflow). Expect the admin to sign you in again: the cookie belongs to the old origin.
5. Submit the new `https://example.com/sitemap.xml` to Google Search Console.
6. Decide the old address: keep it (it serves the same site, and search engines may index both) or set `"workers_dev": false` and redeploy.

## Staging

Not set up. If you want one later, copy `wrangler.jsonc` to an `env.staging` block with another Worker name and its own Atlas database; do not share the production database.

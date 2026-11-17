# Spikes (Phase M1)

Spike code lives in `api/spikes/` and is deleted once its result is recorded here. Claude Code had no Cloudflare login, so
the deployed spikes (a, e, g, h) are written and waiting for you to run them. Run order and commands are below the table.

| Spike | Method | Result | Decision |
|-------|--------|--------|----------|
| a. Password hashing | deployed free-plan Worker: bcryptjs 10, PBKDF2-SHA256 at 100k..1M, argon2id WASM; 20 tries each | pending (needs deploy) | pending |
| b. HTML sanitiser | 2+ pure-JS candidates in workerd, 25+ payload corpus | pending | pending |
| c. OpenAPI from zod | generator reproduces a fragment of `docs/legacy-openapi.json` | pending | pending |
| d. Bundle size | `wrangler deploy --dry-run` (2026-11-17, API foundation: express 5.3.0, mongoose 9.12.2, bcryptjs, hash-wasm) | 4272.92 KiB uncompressed, 759.74 KiB gzip. Wrangler printed no limit; Cloudflare docs list 3 MB gzip for the free plan (confirm) | fits with room; recheck after the sanitiser and zod are added |
| e. Atlas latency | 20 calls to `/e/ping` from a deployed Worker | pending (needs deploy) | pending |
| f. Rate limiting | Cloudflare docs on the free plan, else Mongo TTL counter | pending | pending |
| g. Repository media | 5 MB multipart + 3 WebP variants via GitHub Git Data API; two concurrent uploads | pending (needs deploy and token) | pending |
| h. Single-origin routing | static assets + `run_worker_first` | pending (needs deploy) | pending |

Also verified locally in M1: `wrangler dev` runs the Express app in workerd against Mongo (health, locales, 404 envelope).
Findings: `node:*-slim` has no CA bundle, so `docker/node/dev.sh` installs `ca-certificates` (workerd fails without it). Alpine
was not tried. pnpm 12 needs `allowBuilds` for esbuild and workerd.

## Commands (run from `api/`, after `wrangler login`)
```
pnpm install
# a + e: one spike Worker
pnpm exec wrangler secret put MONGODB_URI -c spikes/wrangler.jsonc     # an Atlas M0 URI (spike database gdsite_spike)
pnpm exec wrangler deploy -c spikes/wrangler.jsonc                     # prints https://gd-spike.<you>.workers.dev
node spikes/run.mjs https://gd-spike.<you>.workers.dev a               # in a second terminal:
pnpm exec wrangler tail gd-spike --format json                         # note cpuTime / outcome (exceededCpu) per request
node spikes/run.mjs https://gd-spike.<you>.workers.dev e
# g: needs a fine-grained token (this repo only, Contents write) and a scratch branch
git push origin main:refs/heads/spike/media
pnpm exec wrangler secret put GITHUB_REPO_TOKEN -c spikes/wrangler.jsonc
# build 1 original (5 MB) + 3 WebP variants as files, then:
curl -F a=@orig.bin -F v1=@v1.webp -F v2=@v2.webp -F v3=@v3.webp https://gd-spike.<you>.workers.dev/g/upload
# repeat twice in parallel for the concurrency check; then: git push origin --delete spike/media
# h: second Worker with static assets
pnpm exec wrangler deploy -c spikes/wrangler.h.jsonc
node spikes/run.mjs https://gd-spike-h.<you>.workers.dev h             # compare with observability: only /admin/users/42 and /api/* invoke the Worker
```

# Spikes (Phase M1)

**Status (2026-11-18):** spikes a, e, g and h were skipped by decision so M1 and M2 could be ticked. They are known gaps, not results: password hashing is provisional PBKDF2 (ADR 016, unverified against the 10 ms free-plan CPU limit), and Atlas latency, GitHub media commits and single-origin routing are untested on a deployed Worker. Run them before M8 (Cloudflare delivery) and certainly before M9.

Spike code lives in `api/spikes/` and is deleted once its result is recorded here. Claude Code had no Cloudflare login, so
the deployed spikes (a, e, g, h) are written and waiting for you to run them. Run order and commands are below the table.

| Spike | Method | Result | Decision |
|-------|--------|--------|----------|
| a. Password hashing | deployed free-plan Worker: bcryptjs 10, PBKDF2-SHA256 at 100k..1M, argon2id WASM; 20 tries each | pending (needs deploy) | pending |
| b. HTML sanitiser | 3 candidates run inside workerd (`wrangler dev`) against 35 hostile payloads (script, onerror, javascript:/vbscript:/data: URIs with case, entity and whitespace tricks, SVG, MathML mutation, style, iframe/srcdoc, form, base/meta/link, nested and split-tag tricks) and 10 allowed-markup checks from the legacy allowlist | sanitize-html 2.18.2: 35/35 inert, 10/10 kept. xss 1.0.17: 35/35 inert, 10/10 kept. dompurify 3.4.18 + linkedom 0.18.15: 2/35 inert, because DOMPurify does not support the linkedom window and returns the input unchanged (fails open) | **sanitize-html** (parser based, per-tag allowlists; ADR 013). M5 adds `rel="noopener noreferrer"` on `target=_blank` links and keeps the corpus as a permanent test |
| c. OpenAPI from zod | `StoreFaqRequest` and `FaqResource` rebuilt in zod 4.6.7 and compared (sorted keys, ignoring `title`) with `docs/legacy-openapi.json` | `@asteasolutions/zod-to-openapi` 9.1.0 (OpenAPI 3.1): both IDENTICAL, including `type: [string, null]`. zod 4 built-in `z.toJSONSchema`: different (`anyOf` with null, safe-integer min/max, date-time regex). `extendZodWithOpenApi(z)` must run before any schema is created | **@asteasolutions/zod-to-openapi 9.1.0** (ADR 014). Use `z.number().int()` and `z.string().datetime()` |
| d. Bundle size | `wrangler deploy --dry-run` (2026-11-17, API foundation: express 5.3.0, mongoose 9.12.2, bcryptjs, hash-wasm) | 4272.92 KiB uncompressed, 759.74 KiB gzip. Wrangler printed no limit; Cloudflare docs list 3 MB gzip for the free plan (confirm) | fits with room; recheck after the sanitiser and zod are added |
| e. Atlas latency | 20 calls to `/e/ping` from a deployed Worker | pending (needs deploy) | pending |
| f. Rate limiting | Cloudflare docs, fetched 2026-11-17: [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [WAF rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Binding: period must be 10 or 60 s, limits are approximate and per Cloudflare location; the docs do not say whether Free includes it. WAF rules on Free: 1 rule, 10 s period, IP only, but they need a zone and `workers.dev` has none. Free Workers: 10 ms CPU per request, 50 subrequests, 100,000 requests a day | **Mongo TTL counter** for login and contact (ADR 015); the binding may be added later as an outer layer after a deployed check. Note the 10 ms CPU limit for spike a |
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

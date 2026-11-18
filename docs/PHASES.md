# Phases

MERN on Cloudflare free tier. The Laravel kit's table is in `docs/PHASES-laravel.md`.
Tick a phase only when it is finished and committed.

| Done | # | Phase | Scope |
|------|---|-------|-------|
| [x] | M0 | freeze and reset | legacy-api/, docs reset, ADR 012, version pins, CLAUDE.md |
| [x] | M1 | Worker foundation and spikes | Worker foundation done; spikes a, e, g, h skipped by decision (docs/SPIKES.md) |
| [x] | M2 | auth and RBAC | users, roles, menus, JWT + refresh cookie, seeds, route audit; hashing provisional (ADR 016) |
| [x] | M3 | settings, sections, media | |
| [x] | M4 | content modules | |
| [x] | M5 | blog, contact, publish pipeline | |
| [x] | M6 | admin | |
| [x] | M7 | portal static export | |
| [x] | M8 | Cloudflare delivery | workflows, wrangler.jsonc, assembly, DEPLOY.md; nothing deployed; spikes a, e, g, h verified on the real deployment (DEPLOY.md Part D) |
| [x] | M9 | hardening and QA | security review with 5 fixes and a test each, indexes in code, limits measured locally, axe on all page types, docs/LIMITS.md and SECURITY.md; deployed checks and Lighthouse listed as residual |
| [ ] | M10 | release | |

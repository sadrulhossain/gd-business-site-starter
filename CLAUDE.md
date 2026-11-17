# gd-business-site-boilerplate

## Repo map
- `api/` — Express 5 API for one Cloudflare Worker (MongoDB Atlas, wrangler); stub until Phase M1
- `legacy-api/` — read-only Laravel reference (tag laravel-v1.0.0); nothing imports from it; deleted in M10
- `web/admin` — Vite React admin app (served at /admin/)
- `web/portal` — Next.js static-export public portal
- `packages/` — shared packages
- `media/` — uploaded images, committed through the GitHub API (from M3)
- `docker/` — local dev Dockerfiles and compose config (MongoDB for dev; replaced in M1)
- `.github/workflows/` — build and deploy with wrangler (GitHub Actions, no Cloudflare build minutes)
- `docs/` — PHASES.md, VERSIONS.md, ENV.md, DECISIONS.md (ADR 012), PATTERNS.md

## Make commands
Planned for the new stack; Phase M1 replaces the current Makefile (still the Laravel one until then).
- `make up` / `make down` — start / stop the local stack (API on wrangler dev, MongoDB, admin, portal)
- `make ports` — check host ports from .env are free or ours
- `make versions` — check .env *_VERSION pins against docs/VERSIONS.md
- `make t FILTER=...` — targeted API tests
- `make check` — lint, typecheck, tests, npm audit, version pins (run once, at the end of a phase)

## Rules
1) One phase at a time; read only CLAUDE.md, the phase row and files it names.
2) No repo-wide exploring, no unrelated refactors, no dependency not in VERSIONS.md.
3) Reuse the reference patterns in docs/PATTERNS.md; do not invent new ones.
4) While working run only targeted tests (make t FILTER=...); run make check once at the end.
5) Keep command output short (quiet flags, | tail -n 20). Never paste logs back.
6) No screenshots unless the phase says so.
7) Finish: tick the phase, git commit "phase N: title", reply in 8 lines or fewer
   (done, deviations, decisions I must make), then STOP and wait for approval.
8) Commits and PRs: never add a Claude signature, Co-Authored-By trailer, "Generated with" line
   or any other Claude attribution to commit messages, PR descriptions, code or docs. Anywhere.

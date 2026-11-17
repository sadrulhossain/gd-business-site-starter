# Contract differences from the Laravel API

`scripts/openapi-parity.mjs` (run by `make openapi`) compares `packages/api-types/openapi.json` (generated from the zod
schemas and the route registry) with `docs/legacy-openapi.json`. The rules:

- every legacy path and method must exist (paths compare with parameter names ignored: `{faq}` equals `{id}`);
- request bodies must have the same content type and the same required fields;
- the `data` object of every 2xx response must keep all legacy required fields (extra fields are allowed);
- Laravel's `apiResource` accepts `PUT` and `PATCH`; the legacy spec lists `PUT` only, so the `PATCH` twin is not a difference.

Every other difference must be listed below. The script fails on an unlisted difference and on a listed row that is no
longer a difference. The key in the first column is exactly what the script prints.

| Difference | Why |
|---|---|
| `extra POST /v1/auth/login` | New auth flow: short access token plus rotating refresh cookie (ADR 016). Laravel Passport used the OAuth token endpoint. |
| `extra POST /v1/auth/refresh` | Same: exchanges the HttpOnly refresh cookie for a new access token. |
| `extra GET /v1/site/status` | Publish pipeline (M5): the admin shows whether content changed since the last build. |
| `extra POST /v1/site/publish` | Publish pipeline (M5): "publish now" dispatches the build workflow immediately. |
| `body POST /v1/posts` | `slug` is optional: it is generated from the title when omitted, and frozen once the post is published. |
| `body POST /v1/settings/logo` | Media upload (ADR 017): the browser sends WebP `variants`, `width` and `height` instead of the original `image`. |
| `body POST /v1/sections/{}/image` | Media upload (ADR 017), as above. |
| `body POST /v1/hero/image` | Media upload (ADR 017), as above. |
| `body POST /v1/about/image` | Media upload (ADR 017), as above. |
| `body POST /v1/services/{}/image` | Media upload (ADR 017), as above. |
| `body POST /v1/testimonials/{}/image` | Media upload (ADR 017), as above. |
| `body POST /v1/team/{}/image` | Media upload (ADR 017), as above. |
| `body POST /v1/gallery/{}/image` | Media upload (ADR 017), as above. |
| `body POST /v1/posts/{}/image` | Media upload (ADR 017), as above. |

The favicon upload (`POST /v1/settings/favicon`) keeps the legacy `image` field (one `.ico` or `.png` file, at most 100 KB).

## Differences that the script does not see

- Responses add `width`, `height` and `committed_at` to every image object, and `category` is always present on posts.
- Validation errors use the legacy envelope (`error.code` is `unprocessable`, legacy used `validation_failed`).
- Unknown JSON fields are rejected with 422 (the legacy form requests ignored them).
- `POST /v1/contact` with the honeypot field filled answers 201 and stores nothing; legacy answered 422.
- Contact messages have no delete route, as in legacy.

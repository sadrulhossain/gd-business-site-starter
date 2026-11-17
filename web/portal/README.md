# Portal (static export)

The public site is a Next.js static export: `next build` writes plain files to `out/`, and the single Cloudflare Worker
serves them. Nothing runs on a server: no route handlers, no middleware, no revalidation. Content changes go live when
the publish pipeline (M5) triggers a new build.

## Variables

| Variable | When | Notes |
|---|---|---|
| `BUILD_API_URL` | build | Absolute address of the live Worker including `/api`, e.g. `https://example.com/api`. Used only by build-time fetches; never reaches the bundle (a smoke test searches `out/` for it). |
| `NEXT_PUBLIC_API_URL` | build, browser | Empty in production: the contact form calls `/api/v1/...` on the same origin, without cookies. |
| `SITE_URL` | build | Public origin, for canonical, hreflang, Open Graph, `sitemap.xml`, `robots.txt` and JSON-LD. |
| `LOCALE_DEFAULT`, `LOCALE_SUPPORTED` | build | The default language is served from `/`, the second from `/<code>/`. Must match the API. |

Only `NEXT_PUBLIC_API_URL`, `SITE_URL` and `LOCALE_*` are public. There are no secrets in the bundle.

## Build

```
BUILD_API_URL=https://example.com/api SITE_URL=https://example.com pnpm --filter portal build
```

`pnpm build` runs `next build` and then `scripts/finalize-export.mjs`, which:

1. turns `out/404.html` into the localised 404 page (header, footer, text);
2. moves `out/<default>/` to `out/` (so the default language has no prefix) and deletes `out/<default>/`;
3. writes `out/_redirects.portal` (`/<default>/*` to `/*` with 301, so no duplicate URLs; M8 merges it into the single `_redirects` file);
4. removes placeholder pages (a dynamic route must generate at least one page, so a site with no posts, categories or a second page of posts gets a placeholder that is deleted again);
5. adds a `Content-Security-Policy` meta tag to every page with the hashes of that page's own inline scripts. The other headers are in `public/_headers.portal` (M8 merges it with the admin rules).

Duration: about one minute for a small site on a laptop (Turbopack compile about 50 s, then one request per page to the API; a site with 100 posts adds roughly 200 pages across both languages). The cost grows with the number of pages, not the size of the images.

## URLs

| Page | Default language | Second language |
|---|---|---|
| Home, section pages | `/`, `/about/`, `/services/`, ... | `/bn/`, `/bn/about/`, ... |
| Service | `/services/<id>/` | `/bn/services/<id>/` |
| Blog list | `/blog/`, `/blog/page/2/` | `/bn/blog/`, `/bn/blog/page/2/` |
| Blog category | `/blog/category/<slug>/`, `.../page/2/` | `/bn/blog/category/<slug>/`, ... |
| Post | `/blog/<slug>/` | `/bn/blog/<slug>/` |

Every URL ends with a slash. The old query URLs (`/blog?category=x&page=2`) are not redirected: none were ever public.
Unknown paths get `404.html`. Hidden sections, drafts and scheduled posts are not generated.

## When the API is down

Every build-time request is retried three times (0.5 s, then 1 s between attempts). If it still fails, or `BUILD_API_URL` is
missing, the build stops with a message naming the URL and the reason, and `out/` is not produced. The workflow (M8)
only uploads a finished `out/`, so the live site keeps serving the previous build. A 404 from the API (a post that was
unpublished between the list and the detail request) is not retried; that page is skipped as not found.

## Tests

- `pnpm test` (Vitest): finalize script, redirects, CSP hashes, retry behaviour, URL helpers.
- `pnpm test:e2e` builds from a fixture API (`test/fixture-api.mjs`, 14 posts in two categories, two languages), runs
  the finalize step and then the Playwright smoke tests against `out/` served like Cloudflare (`scripts/serve-out.mjs`):
  both languages, language switch, service and post pages, blog pagination and categories, the `/en/` redirect, the contact
  form against a mocked API, sitemap and robots, 404, CSP violations, no request to another origin, and no `BUILD_API_URL` in `out/`.
  Browsers are in the `mcr.microsoft.com/playwright:v1.65.0-noble` image.

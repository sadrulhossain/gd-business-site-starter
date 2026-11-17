// Serves out/ the way Cloudflare static assets will (auto-trailing-slash, _redirects, 404.html), for the smoke tests.
//   node scripts/serve-out.mjs [port]
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' }

/** Parses `_redirects` lines: `/from /to [status]`, with a trailing `*` splat in `from` and `:splat` in `to`. */
export function parseRedirects(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [from, to, status = '301'] = l.split(/\s+/)
      return { from, to, status: Number(status) }
    })
}

export function matchRedirect(rules, pathname) {
  for (const { from, to, status } of rules) {
    if (from.endsWith('*')) {
      const prefix = from.slice(0, -1)
      if (pathname.startsWith(prefix)) return { location: to.replace(':splat', pathname.slice(prefix.length)), status }
    } else if (pathname === from) return { location: to, status }
  }
  return null
}

export function serve(root, port) {
  const out = resolve(root)
  const rules = existsSync(join(out, '_redirects.portal')) ? parseRedirects(readFileSync(join(out, '_redirects.portal'), 'utf8')) : []
  const file = (path) => (existsSync(path) && statSync(path).isFile() ? path : null)

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const pathname = decodeURIComponent(url.pathname)
    const redirect = matchRedirect(rules, pathname)
    if (redirect) {
      res.writeHead(redirect.status, { Location: redirect.location + url.search })
      return res.end()
    }

    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
    const target = file(join(out, safe)) ?? file(join(out, safe, 'index.html')) ?? file(join(out, `${safe}.html`))
    // Auto-trailing-slash: /blog -> /blog/ when blog/index.html exists.
    if (!extname(safe) && !pathname.endsWith('/') && file(join(out, safe, 'index.html'))) {
      res.writeHead(308, { Location: `${pathname}/${url.search}` })
      return res.end()
    }

    const status = target ? 200 : 404
    const body = target ?? join(out, '404.html')
    res.writeHead(status, { 'Content-Type': TYPES[extname(body)] ?? 'application/octet-stream' })
    res.end(readFileSync(body))
  })

  return new Promise((resolveListen) => server.listen(port, '127.0.0.1', () => resolveListen(server)))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await serve(process.argv[3] ?? 'out', Number(process.argv[2] ?? 4173))
  console.log('serving out/')
}

// Builds dist/site/, the one asset folder of the Worker (wrangler.jsonc assets.directory):
//   web/portal/out  -> dist/site/          (site root)
//   web/admin/dist  -> dist/site/admin/
//   media/          -> dist/site/media/    (README.md is not published)
// and writes ONE _headers and ONE _redirects. Cloudflare reads only files with those exact names, so the per-app
// sources (_headers.portal, _headers.admin, _redirects.portal) are merged and never copied as assets.
//
// _headers has no "everything except" rule, so the portal's /* block is scoped to the portal's own top-level paths
// (read from web/portal/out). A catch-all would put the portal CSP and cache rules on /admin/* and /media/*.
//
// Usage: node scripts/assemble-site.mjs [--bootstrap] [--out dist/site]
//   --bootstrap  skips the portal and writes a one-page placeholder instead (first deploy, before the API can be read).
// Limits (developers.cloudflare.com/workers/static-assets/headers and /redirects): 100 header rules, 2,000 header line
// characters, 2,000 static + 100 dynamic redirects, 1,000 characters per redirect. The build fails above 80 percent.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HEADER_RULES_MAX = 100
export const HEADER_LINE_MAX = 2000
export const REDIRECTS_STATIC_MAX = 2000
export const REDIRECTS_DYNAMIC_MAX = 100
export const REDIRECT_LINE_MAX = 1000
const SOFT = 0.8
const RESERVED = new Set(['admin', 'api', 'media'])
const SOURCE_FILE = /^_(headers|redirects)\.(portal|admin)$/

export const MEDIA_HEADERS = [
  { path: '/media/*', headers: ['Cache-Control: public, max-age=31536000, immutable', "Content-Security-Policy: default-src 'none'; sandbox", 'X-Content-Type-Options: nosniff'] },
]

/** _headers text -> [{ path, headers: ['Name: value', ...] }]. Comments and blank lines are dropped. */
export function parseHeaders(text) {
  const blocks = []
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue
    if (/^\s/.test(raw)) {
      if (!blocks.length) throw new Error(`header line before any path: "${raw.trim()}"`)
      if (!/^[A-Za-z0-9-]+:\s*\S/.test(raw.trim())) throw new Error(`not a "Name: value" header: "${raw.trim()}"`)
      blocks.at(-1).headers.push(raw.trim())
    } else {
      if (!raw.startsWith('/')) throw new Error(`a header rule must start with /: "${raw.trim()}"`)
      blocks.push({ path: raw.trim(), headers: [] })
    }
  }
  return blocks
}

export const formatHeaders = (blocks) => blocks.map((b) => `${b.path}\n${b.headers.map((h) => `  ${h}`).join('\n')}\n`).join('')

/** Portal URL paths to scope the /* block to: / plus every top-level entry of the export. */
export function portalPaths(outDir) {
  const paths = new Set(['/'])
  const entries = readdirSync(outDir, { withFileTypes: true }).filter((e) => !SOURCE_FILE.test(e.name))
  for (const e of entries) {
    const base = e.name.replace(/\.html$/, '')
    if (RESERVED.has(base)) throw new Error(`web/portal/out/${e.name} collides with /${base}, which belongs to the Worker or the admin`)
    if (e.isDirectory()) {
      paths.add(`/${e.name}/*`)
      if (existsSync(join(outDir, `${e.name}.html`))) paths.add(`/${e.name}`)
    } else if (e.name === 'index.html') {
      paths.add('/')
    } else if (e.name.endsWith('.html')) {
      paths.add(`/${base}`)
      if (e.name === '404.html') paths.add('/404.html')
    } else {
      paths.add(`/${e.name}`)
    }
  }
  return [...paths].sort()
}

/** Replaces the portal's /* block by one copy per portal path; other portal blocks (e.g. /_next/static/*) stay. */
export function scopePortal(blocks, paths) {
  const general = blocks.filter((b) => b.path === '/*')
  if (general.length !== 1) throw new Error('_headers.portal must hold exactly one /* block')
  const scoped = paths.map((path) => ({
    path,
    // /_next/* gets its Cache-Control only from /_next/static/*; two values would be joined with a comma.
    headers: general[0].headers.filter((h) => !(path.startsWith('/_next/') && /^cache-control:/i.test(h))),
  }))
  return [...scoped, ...blocks.filter((b) => b.path !== '/*')]
}

const globToRegExp = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)

/** Fails on a duplicate path, a header set twice for one URL, a bad line length, or more than 80 percent of the rule limit. */
export function checkHeaders(blocks) {
  const errors = []
  const seen = new Set()
  for (const b of blocks) {
    if (seen.has(b.path)) errors.push(`duplicate rule for ${b.path}`)
    seen.add(b.path)
    for (const h of b.headers) if (h.length > HEADER_LINE_MAX * SOFT) errors.push(`header line above 80 percent of ${HEADER_LINE_MAX} characters: ${h.slice(0, 40)}...`)
  }
  if (blocks.length > HEADER_RULES_MAX * SOFT) errors.push(`${blocks.length} header rules; 80 percent of the ${HEADER_RULES_MAX} limit is ${HEADER_RULES_MAX * SOFT}`)
  const matchers = blocks.map((b) => ({ b, re: globToRegExp(b.path) }))
  for (const { b } of matchers) {
    for (const sample of new Set([b.path.replace(/\*/g, 'x'), b.path.replace(/\/\*$/, '/')])) {
      const names = new Map()
      for (const m of matchers.filter((x) => x.re.test(sample))) {
        for (const h of m.b.headers) {
          const name = h.slice(0, h.indexOf(':')).toLowerCase()
          names.set(name, [...(names.get(name) ?? []), m.b.path])
        }
      }
      for (const [name, paths] of names) if (paths.length > 1) errors.push(`${name} is set by ${paths.join(' and ')} for ${sample}`)
    }
  }
  return [...new Set(errors)]
}

export function mergeHeaders({ portalText, adminText, paths }) {
  return [...scopePortal(parseHeaders(portalText), paths), ...parseHeaders(adminText), ...MEDIA_HEADERS]
}

/** One _redirects file from the portal's rules; checks syntax, conflicting sources and the 80 percent limits. */
export function mergeRedirects(portalText) {
  const rules = []
  for (const raw of portalText.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const [from, to, status = '302', ...rest] = line.split(/\s+/)
    if (!from?.startsWith('/') || !to || rest.length) throw new Error(`not a redirect line: "${line}"`)
    if (!['301', '302', '303', '307', '308'].includes(status)) throw new Error(`unsupported redirect status in "${line}"`)
    if (line.length > REDIRECT_LINE_MAX * SOFT) throw new Error(`redirect line above 80 percent of ${REDIRECT_LINE_MAX} characters`)
    rules.push({ from, to, status, dynamic: /[*:]/.test(from) })
  }
  const sources = new Map()
  for (const r of rules) {
    const prev = sources.get(r.from)
    if (prev && (prev.to !== r.to || prev.status !== r.status)) throw new Error(`conflicting redirects for ${r.from}`)
    sources.set(r.from, r)
  }
  const unique = [...sources.values()]
  const staticCount = unique.filter((r) => !r.dynamic).length
  const dynamicCount = unique.length - staticCount
  if (staticCount > REDIRECTS_STATIC_MAX * SOFT) throw new Error(`${staticCount} static redirects, above 80 percent of ${REDIRECTS_STATIC_MAX}`)
  if (dynamicCount > REDIRECTS_DYNAMIC_MAX * SOFT) throw new Error(`${dynamicCount} dynamic redirects, above 80 percent of ${REDIRECTS_DYNAMIC_MAX}`)
  // Static rules first: the top-most matching line wins.
  const ordered = [...unique.filter((r) => !r.dynamic), ...unique.filter((r) => r.dynamic)]
  return { text: `# Generated by scripts/assemble-site.mjs\n${ordered.map((r) => `${r.from} ${r.to} ${r.status}`).join('\n')}\n`, staticCount, dynamicCount }
}

const PLACEHOLDER = (title) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><h1>${title}</h1><p>The site is being set up. Please come back soon.</p></body></html>\n`

const copyTree = (from, to) =>
  cpSync(from, to, { recursive: true, filter: (src) => !SOURCE_FILE.test(src.split(/[\\/]/).at(-1)) })

export function assemble({ root = '.', out = 'dist/site', bootstrap = false } = {}) {
  const r = (...p) => resolve(root, ...p)
  const dest = r(out)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })

  let paths
  let redirectsText = '# Generated by scripts/assemble-site.mjs\n'
  if (bootstrap) {
    writeFileSync(join(dest, 'index.html'), PLACEHOLDER('Coming soon'))
    writeFileSync(join(dest, '404.html'), PLACEHOLDER('Page not found'))
    paths = ['/', '/404.html']
  } else {
    const portalOut = r('web/portal/out')
    if (!existsSync(join(portalOut, 'index.html'))) throw new Error('web/portal/out is missing: build the portal first (or pass --bootstrap)')
    copyTree(portalOut, dest)
    paths = portalPaths(portalOut)
    const redirects = join(portalOut, '_redirects.portal')
    if (existsSync(redirects)) redirectsText = mergeRedirects(readFileSync(redirects, 'utf8')).text
  }

  const adminDist = r('web/admin/dist')
  if (!existsSync(join(adminDist, 'index.html'))) throw new Error('web/admin/dist is missing: build the admin first')
  copyTree(adminDist, join(dest, 'admin'))

  const media = r('media')
  if (existsSync(media)) {
    cpSync(media, join(dest, 'media'), { recursive: true, filter: (src) => !/[\\/]media[\\/](README\.md|\.gitkeep)$/.test(src) })
  }

  const blocks = mergeHeaders({
    portalText: readFileSync(r('web/portal/public/_headers.portal'), 'utf8'),
    adminText: readFileSync(r('web/admin/public/_headers.admin'), 'utf8'),
    paths,
  })
  const errors = checkHeaders(blocks)
  if (errors.length) throw new Error(`_headers problems:\n  ${errors.join('\n  ')}`)
  writeFileSync(join(dest, '_headers'), `# Generated by scripts/assemble-site.mjs\n${formatHeaders(blocks)}`)
  writeFileSync(join(dest, '_redirects'), redirectsText)
  return { dest, headerRules: blocks.length, bootstrap }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const outIndex = args.indexOf('--out')
    const result = assemble({ out: outIndex >= 0 ? args[outIndex + 1] : 'dist/site', bootstrap: args.includes('--bootstrap') })
    const count = readdirSync(result.dest).length
    console.log(`assemble-site: ${result.dest} (${count} top-level entries, ${result.headerRules} header rules${result.bootstrap ? ', bootstrap' : ''})`)
  } catch (e) {
    console.error(`assemble-site: ${e.message}`)
    process.exit(1)
  }
}

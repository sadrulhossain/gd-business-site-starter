// node --test scripts/   (no dependency; run by ci.yml and deploy.yml)
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assemble, checkHeaders, mergeHeaders, mergeRedirects, parseHeaders } from './assemble-site.mjs'
import { inspect, problems } from './check-assets.mjs'
import { readVars } from './wrangler-vars.mjs'

const real = (p) => readFileSync(p, 'utf8')
const write = (root, path, text = 'x') => {
  const file = join(root, path)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'assemble-'))
  for (const p of ['index.html', '404.html', 'about/index.html', 'blog/index.html', 'blog/a/index.html', 'sitemap.xml', '_next/static/app.js']) write(root, `web/portal/out/${p}`)
  write(root, 'web/portal/out/_redirects.portal', '/en / 301\n/en/* /:splat 301\n')
  write(root, 'web/portal/out/_headers.portal', 'must not be copied')
  for (const p of ['index.html', 'assets/app.js', '_headers.admin']) write(root, `web/admin/dist/${p}`)
  write(root, 'media/README.md', 'docs')
  write(root, 'media/2026/a.webp', 'img')
  mkdirSync(join(root, 'web/portal/public'), { recursive: true })
  mkdirSync(join(root, 'web/admin/public'), { recursive: true })
  cpSync('web/portal/public/_headers.portal', join(root, 'web/portal/public/_headers.portal'))
  cpSync('web/admin/public/_headers.admin', join(root, 'web/admin/public/_headers.admin'))
  return root
}

test('assembles one site with one _headers and one _redirects', () => {
  const root = fixture()
  try {
    assemble({ root })
    const site = join(root, 'dist/site')
    for (const f of ['index.html', 'admin/index.html', 'admin/assets/app.js', 'media/2026/a.webp', '_headers', '_redirects', '_next/static/app.js']) assert.ok(existsSync(join(site, f)), f)
    assert.ok(!existsSync(join(site, 'media/README.md')), 'media README is not published')
    assert.equal(inspect(site).leftovers.length, 0, 'no *.portal or *.admin file is uploaded')
    assert.deepEqual(problems(inspect(site)), [])
    assert.match(readFileSync(join(site, '_redirects'), 'utf8'), /^\/en \/ 301$/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('no catch-all puts the portal rules on /admin or /media', () => {
  const root = fixture()
  try {
    assemble({ root })
    const blocks = parseHeaders(readFileSync(join(root, 'dist/site/_headers'), 'utf8'))
    assert.ok(!blocks.some((b) => b.path === '/*'))
    const portalCsp = blocks.find((b) => b.path === '/about/*').headers.find((h) => h.startsWith('Content-Security-Policy'))
    const adminBlocks = blocks.filter((b) => b.path.startsWith('/admin') || b.path.startsWith('/media'))
    assert.ok(portalCsp.includes('style-src \'self\'') && !portalCsp.includes('default-src'))
    assert.ok(adminBlocks.length >= 4)
    assert.deepEqual(checkHeaders(blocks), [])
    const admin = blocks.find((b) => b.path === '/admin/')
    assert.deepEqual(admin.headers, ['Cache-Control: no-cache'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('/_next/* gets its Cache-Control only from /_next/static/*', () => {
  const blocks = mergeHeaders({ portalText: real('web/portal/public/_headers.portal'), adminText: real('web/admin/public/_headers.admin'), paths: ['/', '/_next/*'] })
  assert.deepEqual(checkHeaders(blocks), [])
  assert.ok(!blocks.find((b) => b.path === '/_next/*').headers.some((h) => h.startsWith('Cache-Control')))
})

test('fails on a header set twice for one URL', () => {
  const blocks = parseHeaders('/a/*\n  Cache-Control: no-cache\n/a/b\n  Cache-Control: max-age=1\n')
  assert.match(checkHeaders(blocks)[0], /cache-control is set by/)
})

test('fails above 80 percent of the header rule limit', () => {
  const blocks = Array.from({ length: 81 }, (_, i) => ({ path: `/p${i}`, headers: ['X-A: 1'] }))
  assert.match(checkHeaders(blocks).join(), /81 header rules/)
})

test('a portal folder named like a Worker route is refused', () => {
  const root = fixture()
  try {
    write(root, 'web/portal/out/media/index.html')
    assert.throws(() => assemble({ root }), /collides with \/media/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('bootstrap writes a placeholder and still serves the admin', () => {
  const root = fixture()
  try {
    rmSync(join(root, 'web/portal/out'), { recursive: true })
    assemble({ root, bootstrap: true })
    assert.match(readFileSync(join(root, 'dist/site/index.html'), 'utf8'), /Coming soon/)
    assert.ok(existsSync(join(root, 'dist/site/admin/index.html')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('redirects: conflicting sources fail, static rules come first', () => {
  assert.throws(() => mergeRedirects('/a /b 301\n/a /c 301\n'), /conflicting/)
  assert.throws(() => mergeRedirects('/a /b 200\n'), /unsupported/)
  const { text } = mergeRedirects('/en/* /:splat 301\n/en / 301\n')
  assert.ok(text.indexOf('/en / 301') < text.indexOf('/en/*'))
})

test('wrangler-vars reads plain JSON and rejects a bad origin', () => {
  const good = { vars: { SITE_ORIGIN: 'https://x.workers.dev', MONGODB_DB: 'db', LOCALE_DEFAULT: 'en', LOCALE_FALLBACK: 'en', LOCALE_SUPPORTED: 'en,bn' } }
  assert.equal(readVars(JSON.stringify(good)).LOCALE_SUPPORTED, 'en,bn')
  assert.throws(() => readVars(JSON.stringify({ vars: { ...good.vars, SITE_ORIGIN: 'https://x.dev/' } })), /https origin/)
  assert.throws(() => readVars('{ // comment\n}'), /plain JSON/)
  assert.deepEqual(Object.keys(readVars(real('wrangler.jsonc'))), ['SITE_ORIGIN', 'MONGODB_DB', 'LOCALE_DEFAULT', 'LOCALE_FALLBACK', 'LOCALE_SUPPORTED'])
})

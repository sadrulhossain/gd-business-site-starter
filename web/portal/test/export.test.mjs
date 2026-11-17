import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cspFor, finalize, inlineScripts, redirectRules, sha256, withCsp } from '../scripts/finalize-export.mjs'
import { matchRedirect, parseRedirects } from '../scripts/serve-out.mjs'

const page = (body, head = '') => `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`

describe('inline script hashes', () => {
  it('finds inline code only, not src scripts or JSON data', () => {
    const html = page('<script src="/a.js"></script><script>one()</script><script type="application/ld+json">{"a":1}</script><script id="x">two()</script>')
    expect(inlineScripts(html)).toEqual(['one()', 'two()'])
  })

  it('builds a CSP with exactly the page hashes and no unsafe-inline', () => {
    const csp = cspFor(page('<script>one()</script><script>one()</script><script>two()</script>'))
    expect(csp).toBe(`default-src 'self'; script-src 'self' ${sha256('one()')} ${sha256('two()')}`)
    expect(csp).not.toContain('unsafe')
  })

  it('puts the CSP meta first in <head>', () => {
    expect(withCsp(page('<script>x()</script>', '<title>t</title>'))).toMatch(/<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-[^"]+"\/><title>/)
  })
})

describe('redirects', () => {
  it('sends the default-language prefix to the unprefixed URL with 301', () => {
    expect(redirectRules('en')).toContain('/en / 301')
    const rules = parseRedirects(redirectRules('en'))
    expect(matchRedirect(rules, '/en/blog/page/2/')).toEqual({ location: '/blog/page/2/', status: 301 })
    expect(matchRedirect(rules, '/en/')).toEqual({ location: '/', status: 301 })
    expect(matchRedirect(rules, '/en')).toEqual({ location: '/', status: 301 })
    expect(matchRedirect(rules, '/bn/blog/')).toBeNull()
    expect(matchRedirect(rules, '/energy/')).toBeNull()
  })
})

describe('finalize', () => {
  function fakeExport() {
    const out = mkdtempSync(join(tmpdir(), 'export-'))
    const write = (path, text) => {
      mkdirSync(join(out, path, '..'), { recursive: true })
      writeFileSync(join(out, path), text)
    }
    write('en/index.html', page('<script>home()</script>'))
    write('en/blog/index.html', page('blog'))
    write('en/blog/_none/index.html', page('placeholder'))
    write('en/blog/page/0/index.html', page('placeholder page'))
    write('en/blog/page/2/index.html', page('page two'))
    write('en/404-source/index.html', page('<p>404 localised</p>'))
    write('bn/index.html', page('bn home'))
    write('404.html', page('next default'))
    write('404/index.html', page('x'))
    write('_not-found/index.html', page('x'))
    write('_next/static/a.js', 'a')
    return out
  }

  it('moves the default tree to the root, writes 404.html and the redirects, drops placeholders', () => {
    const out = fakeExport()
    finalize({ out, defaultLocale: 'en' })

    expect(existsSync(join(out, 'en'))).toBe(false)
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('home()')
    expect(existsSync(join(out, 'blog/page/2/index.html'))).toBe(true)
    expect(existsSync(join(out, 'blog/_none'))).toBe(false)
    expect(existsSync(join(out, 'blog/page/0'))).toBe(false)
    expect(existsSync(join(out, 'bn/index.html'))).toBe(true)
    expect(readFileSync(join(out, '404.html'), 'utf8')).toContain('404 localised')
    expect(existsSync(join(out, '404'))).toBe(false)
    expect(existsSync(join(out, '404-source'))).toBe(false)
    expect(readFileSync(join(out, '_redirects.portal'), 'utf8')).toContain('/en/* /:splat 301')
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain(`script-src 'self' ${sha256('home()')}`)
  })

  it('refuses to overwrite something at the root', () => {
    const out = fakeExport()
    writeFileSync(join(out, 'blog'), 'a file named blog')
    expect(() => finalize({ out, defaultLocale: 'en' })).toThrow(/already exists/)
  })
})

describe('build-time API access', () => {
  it('retries 5xx and network errors, then fails with a clear message', async () => {
    const { fetchWithRetry } = await import('../lib/api.ts')
    const calls = vi.fn(async () => new Response('', { status: 503 }))
    await expect(fetchWithRetry('http://api.test/x', undefined, { attempts: 3, backoff: 1, doFetch: calls })).rejects.toThrow(/failed after 3 attempts \(HTTP 503\).*Nothing was published/)
    expect(calls).toHaveBeenCalledTimes(3)

    const flaky = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue(new Response('{}', { status: 200 }))
    expect((await fetchWithRetry('http://api.test/x', undefined, { attempts: 3, backoff: 1, doFetch: flaky })).status).toBe(200)
    expect(flaky).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 404 (a normal "no such page")', async () => {
    const { fetchWithRetry } = await import('../lib/api.ts')
    const calls = vi.fn(async () => new Response('', { status: 404 }))
    expect((await fetchWithRetry('http://api.test/x', undefined, { attempts: 3, backoff: 1, doFetch: calls })).status).toBe(404)
    expect(calls).toHaveBeenCalledOnce()
  })

  it('stops the build when BUILD_API_URL is missing', async () => {
    const { buildApiUrl } = await import('../lib/api.ts')
    vi.stubEnv('BUILD_API_URL', '')
    expect(() => buildApiUrl()).toThrow(/BUILD_API_URL is not set/)
    vi.stubEnv('BUILD_API_URL', 'http://api.test/api/')
    expect(buildApiUrl()).toBe('http://api.test/api')
    vi.unstubAllEnvs()
  })
})

describe('final URLs', () => {
  it('localePath gives the trailing-slash URL of each locale', async () => {
    const { localePath, stripLocale } = await import('../lib/i18n.ts')
    expect(localePath('en', '/')).toBe('/')
    expect(localePath('en', '/blog')).toBe('/blog/')
    expect(localePath('en', '/blog/page/2/')).toBe('/blog/page/2/')
    expect(localePath('bn', '/', 'en')).toBe('/bn/')
    expect(localePath('bn', '/blog', 'en')).toBe('/bn/blog/')
    expect(stripLocale('/bn/blog/', ['en', 'bn'], 'en')).toBe('/blog/')
  })
})

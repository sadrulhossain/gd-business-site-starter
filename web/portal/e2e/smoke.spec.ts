import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = 'http://127.0.0.1:4173'

/** Every request that leaves the page for another origin, and CSP violations, are recorded and must stay empty. */
function watch(page: Page) {
  const foreign: string[] = []
  const problems: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url())
  })
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => problems.push(e.message))
  return { foreign, problems }
}

const h1 = (page: Page) => page.getByRole('heading', { level: 1 }).first()

test('both languages render, and the switch keeps the page', async ({ page }) => {
  await page.goto('/about/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(h1(page)).toHaveText('About')

  await page.getByRole('list', { name: 'Language' }).getByRole('link', { name: /bn/i }).or(page.locator('a[hreflang="bn"]')).first().click()
  await expect(page).toHaveURL(/\/bn\/about\/$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')
  await expect(h1(page)).toHaveText('About (bn)')

  await page.locator('a[hreflang="en"]').first().click()
  await expect(page).toHaveURL(/127\.0\.0\.1:4173\/about\/$/)
})

test('canonical and hreflang use the final URLs', async ({ page }) => {
  await page.goto('/bn/blog/')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${ORIGIN}/bn/blog/`)
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', `${ORIGIN}/blog/`)
  await expect(page.locator('link[rel="alternate"][hreflang="bn"]')).toHaveAttribute('href', `${ORIGIN}/bn/blog/`)
})

test('a service page and a post page exist, in both languages', async ({ page }) => {
  await page.goto('/services/2/')
  await expect(h1(page)).toHaveText('Service 2')
  await page.goto('/bn/services/2/')
  await expect(h1(page)).toHaveText('Service 2 (bn)')
  await page.goto('/blog/post-5/')
  await expect(h1(page)).toHaveText('Post 5')
  await expect.poll(() => page.locator('script[type="application/ld+json"]').first().evaluate((el) => el.textContent)).toContain('"Article"')
  await page.goto('/bn/blog/post-5/')
  await expect(h1(page)).toHaveText('Post 5 (bn)')
})

test('blog pagination and category pages are paths, not queries', async ({ page }) => {
  await page.goto('/blog/')
  await expect(page.locator('main li h2')).toHaveCount(12)
  await page.getByRole('link', { name: /Next/ }).click()
  await expect(page).toHaveURL(/\/blog\/page\/2\/$/)
  await expect(page.locator('main li h2')).toHaveCount(2)

  await page.goto('/blog/category/news/')
  await expect(page.locator('main li h2')).toHaveCount(12)
  await page.goto('/blog/category/news/page/2/')
  await expect(page.locator('main li h2')).toHaveCount(1)
  await page.goto('/blog/category/tips/')
  await expect(page.locator('main li h2')).toHaveCount(1)
  await page.goto('/bn/blog/category/news/page/2/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')

  expect((await page.request.get('/blog/page/3/')).status()).toBe(404)
  expect((await page.request.get('/blog/category/missing/')).status()).toBe(404)
})

test('the default language has no /en/ prefix: it redirects with 301', async ({ request }) => {
  const response = await request.get('/en/about/', { maxRedirects: 0 })
  expect(response.status()).toBe(301)
  expect(response.headers().location).toBe('/about/')
  expect((await request.get('/en', { maxRedirects: 0 })).headers().location).toBe('/')
  expect((await request.get('/about/')).status()).toBe(200)
})

test('contact form loads a captcha and posts to the (mocked) API origin without cookies', async ({ page }) => {
  const watcher = watch(page)
  let posted: { body: Record<string, unknown>; cookie: string | undefined } | null = null
  await page.route('**/api/v1/public/captcha', (route) => route.fulfill({ json: { data: { id: 'cap-1', question: '2 + 3' } } }))
  await page.route('**/api/v1/contact', async (route) => {
    posted = { body: route.request().postDataJSON(), cookie: route.request().headers().cookie }
    await route.fulfill({ status: 201, json: { data: { received: true } } })
  })

  await page.goto('/contact/')
  await expect(page.locator('label[for="contact-captcha"]')).toContainText('2 + 3')
  await page.fill('#contact-name', 'Ann')
  await page.fill('#contact-email', 'ann@example.test')
  await page.fill('#contact-message', 'Hello there')
  await page.fill('#contact-captcha', '5')
  await page.locator('form button[type="submit"]').click()

  await expect(page.getByRole('status')).toBeVisible()
  expect(posted!.body).toMatchObject({ name: 'Ann', email: 'ann@example.test', message: 'Hello there', captcha_id: 'cap-1', captcha_answer: 5 })
  expect(posted!.cookie).toBeUndefined()
  expect(watcher.foreign).toEqual([])
})

test('contact form shows the throttle message on 429 and field errors on 422', async ({ page }) => {
  await page.route('**/api/v1/public/captcha', (route) => route.fulfill({ json: { data: { id: 'cap-2', question: '1 + 1' } } }))
  let status = 429
  await page.route('**/api/v1/contact', (route) => route.fulfill(status === 429 ? { status, json: { error: { code: 'too_many_requests', message: 'Too many' } } } : { status, json: { error: { code: 'unprocessable', message: 'Invalid', details: { email: ['The email field must be a valid email address.'] } } } }))

  await page.goto('/contact/')
  await expect(page.locator('#contact-captcha')).toBeEnabled()
  await page.fill('#contact-name', 'Ann')
  await page.fill('#contact-email', 'ann@example.test')
  await page.fill('#contact-message', 'Hello')
  await page.fill('#contact-captcha', '2')
  await page.locator('form button[type="submit"]').click()
  await expect(page.locator('#contact-notice')).toBeVisible()

  status = 422
  await expect(page.locator('#contact-captcha')).toBeEnabled()
  await page.fill('#contact-captcha', '2')
  await page.locator('form button[type="submit"]').click()
  await expect(page.getByText('The email field must be a valid email address.')).toBeVisible()
})

test('sitemap and robots are valid and list final URLs for both languages', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text()
  expect(sitemap).toContain('<urlset')
  for (const url of [`${ORIGIN}/`, `${ORIGIN}/bn/`, `${ORIGIN}/blog/page/2/`, `${ORIGIN}/bn/blog/category/news/`, `${ORIGIN}/blog/post-3/`, `${ORIGIN}/services/1/`]) expect(sitemap).toContain(`<loc>${url}</loc>`)
  expect(sitemap).toContain('hreflang="bn"')
  expect(sitemap).not.toContain('/en/')
  expect(sitemap).not.toContain('_none')

  const robots = await (await request.get('/robots.txt')).text()
  expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
  expect(robots).toContain('Disallow: /api/')
})

test('unknown paths answer 404 with the localised page, with no CSP violation', async ({ page }) => {
  const watcher = watch(page)
  const response = await page.goto('/nothing-here/')
  expect(response!.status()).toBe(404)
  await expect(page.getByText('404').first()).toBeVisible()
  await page.goto('/bn/nothing-here/')
  await expect(page.getByText('404').first()).toBeVisible()
  expect(watcher.problems).toEqual([])
})

test('pages run under their CSP and make no request to another origin', async ({ page }) => {
  const watcher = watch(page)
  for (const path of ['/', '/bn/', '/services/1/', '/blog/', '/blog/post-1/', '/contact/']) {
    await page.goto(path)
    await expect(h1(page)).toBeVisible()
  }
  expect(watcher.problems).toEqual([])
  expect(watcher.foreign).toEqual([])
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).not.toContain('unsafe-inline')
})

test('the build address of the API appears nowhere in out/', () => {
  const secret = '127.0.0.1:4010'
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (readFileSync(path).includes(secret)) hits.push(path)
    }
  }
  expect(existsSync('out')).toBe(true)
  walk('out')
  expect(hits).toEqual([])
})

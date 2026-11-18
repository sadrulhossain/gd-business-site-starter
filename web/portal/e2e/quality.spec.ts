import { expect, test, type Page } from '@playwright/test'

// Phase M9 gates against the static export: keyboard and screen-reader behaviour of the contact form, social and
// structured-data tags, mixed content. (axe lives in a11y.spec.ts; CSP violations and canonical/hreflang in smoke.spec.ts.)
const ORIGIN = 'http://127.0.0.1:4173'

async function stubContactApi(page: Page) {
  await page.route('**/api/v1/public/captcha', (route) => route.fulfill({ json: { data: { id: 'cap-q', question: '4 + 3' } } }))
  await page.route('**/api/v1/contact', (route) =>
    route.fulfill({ status: 422, json: { error: { code: 'unprocessable', message: 'Invalid', details: { email: ['The email field must be a valid email address.'] } } } }),
  )
}

test.describe('contact form, keyboard and screen reader', () => {
  test('every field has a label, the captcha question is part of its label, the honeypot is out of reach', async ({ page }) => {
    await stubContactApi(page)
    await page.goto('/contact/')
    await expect(page.locator('label[for="contact-captcha"]')).toContainText('4 + 3')
    for (const label of [/name/i, /email/i, /message/i]) await expect(page.getByLabel(label).first()).toBeVisible()
    const honeypot = page.locator('#contact-website')
    await expect(honeypot).toHaveAttribute('tabindex', '-1')
    await expect(page.locator('div[aria-hidden="true"]:has(#contact-website)')).toHaveCount(1)
  })

  test('Tab reaches name, email, phone, subject, message, captcha and the button in that order, never the honeypot', async ({ page }) => {
    await stubContactApi(page)
    await page.goto('/contact/')
    await expect(page.locator('#contact-captcha')).toBeEnabled()
    await page.locator('#contact-name').focus()
    const order: string[] = []
    for (let i = 0; i < 7; i++) {
      order.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id || (document.activeElement as HTMLElement | null)?.tagName || ''))
      await page.keyboard.press('Tab')
    }
    expect(order).toEqual(['contact-name', 'contact-email', 'contact-phone', 'contact-subject', 'contact-message', 'contact-captcha', 'BUTTON'])
  })

  test('submitting with the keyboard announces the problem and links each error to its field', async ({ page }) => {
    await stubContactApi(page)
    await page.goto('/contact/')
    await expect(page.locator('#contact-captcha')).toBeEnabled()
    await page.fill('#contact-name', 'Ann')
    await page.fill('#contact-email', 'not-an-email')
    await page.fill('#contact-message', 'Hello')
    await page.fill('#contact-captcha', '7')
    await page.locator('#contact-captcha').press('Enter')

    const email = page.locator('#contact-email')
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await email.getAttribute('aria-describedby')
    expect(describedBy).toBe('contact-email-error')
    await expect(page.locator(`#${describedBy}`)).toContainText('valid email')
    // Something announces the failure: an alert region or a status that screen readers pick up.
    await expect(page.locator('[role="alert"], [role="status"], [aria-live]').first()).toBeAttached()
  })

  test('the focus moves to the first field with an error, so a keyboard user does not have to hunt for it', async ({ page }) => {
    await stubContactApi(page)
    await page.goto('/contact/')
    await expect(page.locator('#contact-captcha')).toBeEnabled()
    await page.fill('#contact-name', 'Ann')
    await page.fill('#contact-email', 'not-an-email')
    await page.fill('#contact-message', 'Hello')
    await page.fill('#contact-captcha', '7')
    await page.locator('form button[type="submit"]').press('Enter')
    await expect(page.locator('#contact-email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#contact-email')).toBeFocused()
  })
})

test.describe('social tags and structured data', () => {
  for (const [url, locale] of [['/', 'en'], ['/bn/', 'bn'], ['/blog/post-5/', 'en'], ['/bn/blog/post-5/', 'bn'], ['/services/2/', 'en']] as const) {
    test(`${url}: Open Graph, Twitter card, canonical and JSON-LD agree`, async ({ page }) => {
      await page.goto(url)
      const meta = (sel: string) => page.locator(sel).first().getAttribute('content')
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
      expect(canonical).toBe(`${ORIGIN}${url}`)
      expect(await meta('meta[property="og:url"]')).toBe(canonical)
      expect(await meta('meta[property="og:title"]')).toBeTruthy()
      expect(await meta('meta[property="og:description"]')).toBeTruthy()
      expect(await meta('meta[property="og:type"]')).toBeTruthy()
      expect(await meta('meta[property="og:site_name"]')).toBeTruthy()
      expect(await meta('meta[name="twitter:card"]')).toMatch(/^summary/)
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
      // JSON-LD must be valid JSON with a context and a type, and its urls must be on this origin.
      const blocks = await page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
      // Home pages and posts carry structured data; other pages may have none, but anything present must be valid.
      if (url === '/' || url === '/bn/' || url.includes('/blog/post-')) expect(blocks.length).toBeGreaterThan(0)
      for (const raw of blocks) {
        const data = JSON.parse(raw)
        expect(data['@context']).toBe('https://schema.org')
        expect(data['@type']).toBeTruthy()
        for (const m of raw.matchAll(/"https?:\/\/[^"]+"/g)) {
          if (m[0].includes('schema.org')) continue
          expect(m[0], `url in JSON-LD of ${url}`).toContain('127.0.0.1:4173')
        }
      }
    })
  }

  test('a post page has an Article with headline and dates; the home page a LocalBusiness', async ({ page }) => {
    await page.goto('/blog/post-5/')
    const article = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}')
    expect(article['@type']).toBe('Article')
    expect(article.headline).toBe('Post 5')
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}/)
    await page.goto('/')
    const all = (await page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))).map((s) => JSON.parse(s))
    expect(all.some((d) => d['@type'] === 'LocalBusiness')).toBe(true)
  })
})

test('no page loads anything over plain http from another origin (mixed content)', async ({ page }) => {
  const insecure: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.protocol === 'http:' && u.hostname !== '127.0.0.1') insecure.push(r.url())
  })
  for (const url of ['/', '/blog/', '/contact/', '/blog/post-5/', '/bn/']) await page.goto(url)
  expect(insecure).toEqual([])
  // and no hard-coded http:// link or asset in the markup itself
  const html = await page.content()
  expect(html.match(/(?:src|href|action)="http:\/\/(?!127\.0\.0\.1)[^"]+"/g) ?? []).toEqual([])
})

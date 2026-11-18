import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// WCAG 2.1 A/AA scan of every public page in both languages, against the static export (no screenshots).
// One URL per page type: home, content pages, list and detail, blog list/pagination/category/post, legal, 404.
const paths = ['/', '/about/', '/services/', '/services/2/', '/pricing/', '/faq/', '/gallery/', '/showcase/', '/blog/', '/blog/page/2/', '/blog/category/news/', '/blog/post-5/', '/contact/', '/privacy/', '/terms/', '/missing-page/']

for (const prefix of ['', '/bn']) {
  for (const path of paths) {
    const url = `${prefix}${path}` || '/'

    test(`axe: ${url}`, async ({ page }) => {
      await page.goto(url)
      await expect(page.locator('h1').first()).toBeVisible()

      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()

      expect(
        violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`),
      ).toEqual([])
    })
  }
}

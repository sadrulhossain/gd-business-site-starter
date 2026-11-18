import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// WCAG 2.1 A/AA scan of the admin sign-in page (the only page reachable without a login), plus a keyboard check.
test('axe: the sign-in page has no WCAG 2.1 A/AA violations', async ({ page }) => {
  await page.goto('/admin/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([])
})

test('sign-in works from the keyboard and a wrong password is announced', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill('nobody@example.test')
  await page.getByLabel('Password').fill('wrong-password-123')
  await page.getByLabel('Password').press('Enter')
  await expect(page.locator('[role="alert"], [aria-live]').first()).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/login/)
})

import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? ''
const password = process.env.E2E_PASSWORD ?? ''

test('sign in on the login page and land on the dashboard', async ({ page }) => {
  test.skip(!email || !password, 'set E2E_EMAIL and E2E_PASSWORD')

  await page.goto('/admin/')
  await page.waitForURL(/\/admin\/login/, { timeout: 30_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
})

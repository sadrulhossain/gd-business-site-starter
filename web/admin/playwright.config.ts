import { defineConfig } from '@playwright/test'

/** One spec against the running dev stack (make up): the admin is served under /admin/ and proxies /api to the Worker. */
const origin = process.env.E2E_ADMIN_ORIGIN ?? 'http://localhost:28301'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  reporter: 'line',
  // The dev server compiles on first hit, so the first navigation is slow.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: origin,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ["--no-sandbox"] },
  },
})

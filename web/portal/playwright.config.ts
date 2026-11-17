import { defineConfig } from '@playwright/test'

/**
 * Smoke tests against the static export (out/), served like Cloudflare will: `pnpm test:e2e` builds it from the fixture
 * API first (scripts/e2e.mjs), then runs these. Nothing here needs the API, Mongo or the Worker.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  reporter: 'line',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  webServer: { command: 'node scripts/serve-out.mjs 4173', url: 'http://127.0.0.1:4173/', reuseExistingServer: false },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ['--no-sandbox'] },
  },
})

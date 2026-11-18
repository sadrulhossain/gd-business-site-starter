// Lighthouse budgets for the static export. Not a dependency: Lighthouse 13.6.0 is fetched with npx (docs/VERSIONS.md,
// "Tools run on demand") and needs a Chrome, so run it in the Playwright image (the same one the e2e tests use):
//
//   docker run --rm --ipc=host -v "$PWD:/app" -w /app/web/portal mcr.microsoft.com/playwright:v1.65.0-noble \
//     node scripts/lighthouse.mjs [--desktop] [--pages /,/blog/,/contact/]
//
// It serves out/ the way Cloudflare will (scripts/serve-out.mjs), audits each page with the default mobile profile and
// fails when a category is below its budget. Build out/ first (pnpm build, or scripts/e2e.mjs for the fixture site).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BUDGET = { performance: 90, accessibility: 90, 'best-practices': 90, seo: 90 }
const PORT = 4174
const args = process.argv.slice(2)
const pages = (args.includes('--pages') ? args[args.indexOf('--pages') + 1] : '/,/bn/,/blog/,/blog/post-5/,/contact/,/services/').split(',')
const desktop = args.includes('--desktop')

if (!existsSync('out/index.html')) {
  console.error('lighthouse: out/ is missing; build the portal first')
  process.exit(2)
}

// Chrome from the Playwright image (any chromium under /ms-playwright), or CHROME_PATH.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/ms-playwright'
  for (const dir of existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium')) : []) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) if (existsSync(join(root, dir, rel))) return join(root, dir, rel)
  }
  throw new Error('no Chrome found; set CHROME_PATH')
}

const server = spawn('node', ['scripts/serve-out.mjs', String(PORT)], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))
mkdirSync('.cache', { recursive: true })

const rows = []
let failed = 0
try {
  for (const path of pages) {
    const file = `.cache/lh-${path.replace(/\W+/g, '_') || 'home'}.json`
    const cli = ['-y', 'lighthouse@13.6.0', `http://127.0.0.1:${PORT}${path}`, '--output=json', `--output-path=${file}`, '--quiet',
      `--chrome-path=${findChrome()}`, '--chrome-flags=--headless=new --no-sandbox', `--only-categories=${Object.keys(BUDGET).join(',')}`, ...(desktop ? ['--preset=desktop'] : [])]
    const r = spawnSync('npx', cli, { encoding: 'utf8' })
    if (r.status !== 0) {
      console.error(`lighthouse failed for ${path}:\n${(r.stderr || r.stdout).slice(-600)}`)
      failed++
      continue
    }
    const lhr = JSON.parse(readFileSync(file, 'utf8'))
    const score = Object.fromEntries(Object.keys(BUDGET).map((k) => [k, Math.round((lhr.categories[k]?.score ?? 0) * 100)]))
    rows.push({ path, ...score, lcp: lhr.audits['largest-contentful-paint'].displayValue, tbt: lhr.audits['total-blocking-time'].displayValue, cls: lhr.audits['cumulative-layout-shift'].displayValue, bench: lhr.environment?.benchmarkIndex })
    for (const [k, min] of Object.entries(BUDGET)) if (score[k] < min) failed++
  }
} finally {
  server.kill()
}

console.log(`lighthouse 13.6.0, ${desktop ? 'desktop' : 'mobile (default throttling)'} profile, benchmarkIndex ${rows[0]?.bench ?? '?'} (about 1000 = a fast desktop)`)
console.log('page'.padEnd(18), 'perf', ' a11y', ' bp  ', ' seo', ' LCP     TBT      CLS')
for (const r of rows) console.log(r.path.padEnd(18), String(r.performance).padStart(4), String(r.accessibility).padStart(5), String(r['best-practices']).padStart(4), String(r.seo).padStart(4), ' ', r.lcp.padEnd(8), r.tbt.padEnd(8), r.cls)
console.log(failed ? `lighthouse: ${failed} budget miss(es) (budget: each category at least 90)` : 'lighthouse: all pages meet the budget')
process.exit(failed ? 1 : 0)

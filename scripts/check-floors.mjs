// Fails when a version is below its floor in docs/VERSIONS.md, or when a dependency breaks the pinning rules.
//   1. Image pins in .env (NODE_VERSION, MONGO_VERSION) are not below their floor.
//   2. Every package the lockfile resolves that has a VERSIONS.md row is at or above the floor (the lowest installed copy counts).
//   3. Every direct dependency (package.json of the root, api, web/*, packages/*) has a VERSIONS.md row (CLAUDE.md rule 2),
//      is pinned exactly (or comes from the catalog / workspace) and equals the pin in the table.
// A package is matched to its row by the npm URL in the Source column, or by the aliases below for combined rows.
//   node scripts/check-floors.mjs              the checks above
//   node scripts/check-floors.mjs --upstream   also asks the npm registry that every pinned npm version still exists
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const semver = (s) => (String(s).match(/\d+\.\d+\.\d+/) ?? [])[0]
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.replace(/^v/, '').split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

// Rows whose Source is not an npm URL, or that cover several packages.
const ALIASES = { next: /^Next\.js/, 'react-dom': /^React/, '@types/react-dom': /^@types\/react/ }

const rows = readFileSync('docs/VERSIONS.md', 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('| ') && !l.startsWith('| Component') && !l.startsWith('|--'))
  .map((l) => l.split('|').map((c) => c.trim()))
  .map((c) => ({ component: c[1], pin: semver(c[2]), floor: semver(c[3]), source: c[4] ?? '' }))
  .filter((r) => r.floor)

const byNpm = new Map()
for (const r of rows) {
  const m = /npmjs\.com\/package\/((?:@[^/]+\/)?[^/]+)\/v\//.exec(r.source)
  if (m) byNpm.set(m[1], r)
}
for (const [name, re] of Object.entries(ALIASES)) {
  const row = rows.find((r) => re.test(r.component))
  if (row) byNpm.set(name, row)
}
const rowFor = (name) => byNpm.get(name)

const checks = []
const errors = []

// 1. images
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8')
for (const [key, re] of Object.entries({ NODE_VERSION: /^Node/, MONGO_VERSION: /^MongoDB server/ })) {
  const v = env.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]
  const row = rows.find((r) => re.test(r.component))
  if (v && row) checks.push([key, semver(v), row.floor])
}

// 2. lockfile
const installed = new Map()
if (existsSync('pnpm-lock.yaml')) {
  for (const line of readFileSync('pnpm-lock.yaml', 'utf8').split(/\r?\n/)) {
    const m = /^ {2}'?((?:@[^/@]+\/)?[^@'\s]+)@(\d+\.\d+\.\d+)'?:/.exec(line)
    if (!m) continue
    const have = installed.get(m[1])
    if (!have || cmp(m[2], have) < 0) installed.set(m[1], m[2])
  }
}
for (const [name, row] of byNpm) if (installed.has(name)) checks.push([name, installed.get(name), row.floor])

// 3. direct dependencies
const catalog = {}
if (existsSync('pnpm-workspace.yaml')) {
  let inCatalog = false
  for (const line of readFileSync('pnpm-workspace.yaml', 'utf8').split(/\r?\n/)) {
    if (/^catalog:/.test(line)) inCatalog = true
    else if (/^\S/.test(line)) inCatalog = false
    else if (inCatalog) {
      const m = /^\s+'?([^':]+)'?:\s*(\S+)/.exec(line)
      if (m) catalog[m[1]] = m[2]
    }
  }
}
const manifests = ['package.json', 'api/package.json']
for (const dir of ['web', 'packages']) if (existsSync(dir)) for (const d of readdirSync(dir)) manifests.push(`${dir}/${d}/package.json`)
const direct = new Map()
for (const file of manifests.filter(existsSync)) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, declared] of Object.entries(pkg[section] ?? {})) {
      if (declared.startsWith('workspace:')) continue
      const version = declared.startsWith('catalog:') ? catalog[name] : declared
      const row = rowFor(name)
      if (!row) errors.push(`${file}: ${name} has no row in docs/VERSIONS.md`)
      else if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) errors.push(`${file}: ${name} is "${declared}", pin it exactly`)
      else if (row.pin && version !== row.pin) errors.push(`${file}: ${name} is ${version} but docs/VERSIONS.md pins ${row.pin}`)
      direct.set(name, row)
    }
  }
}

let bad = errors.length
for (const e of errors) console.log(`ERROR ${e}`)
for (const [name, have, floor] of checks) {
  const ok = !floor || !have || cmp(have, floor) >= 0
  if (!ok) bad++
  console.log(`${ok ? 'ok   ' : 'BELOW'} ${name} ${have} (floor ${floor})`)
}

// optional: every pinned npm version still exists upstream
if (process.argv.includes('--upstream')) {
  const seen = new Set()
  for (const [name, row] of byNpm) {
    if (!row.pin || seen.has(`${name}@${row.pin}`)) continue
    seen.add(`${name}@${row.pin}`)
    const r = spawnSync('npm', ['view', `${name}@${row.pin}`, 'version'], { encoding: 'utf8', shell: process.platform === 'win32' })
    const ok = r.status === 0 && r.stdout.trim().split(/\s+/).includes(row.pin)
    if (!ok) bad++
    console.log(`${ok ? 'exists' : 'MISSING'} ${name}@${row.pin}`)
  }
}

console.log(bad ? `floors: ${bad} problem(s)` : `floors: ok (${checks.length} versions, ${direct.size} direct dependencies checked)`)
process.exit(bad ? 1 : 0)

// Measures the API from outside: wall time p50/p99 per scenario, the 429 + Retry-After of the rate limits, and (locally,
// inside the dev container) CPU time per request from the workerd processes.
//   node scripts/measure-api.mjs <base-url> [--cpu] [--samples 40] [--login-samples 27]
// Needs MEASURE_EMAIL and MEASURE_PASSWORD (a user with users.view). Run it against the deployed Worker to fill in
// docs/LIMITS.md; locally it measures workerd + local MongoDB, not the Cloudflare edge and Atlas.
// It sends a few hundred requests: do not point it at a site you do not own. Logins are spaced to stay under the limit
// of 10 a minute, so the login scenario takes about a minute per 9 samples.
import { readdirSync, readFileSync } from 'node:fs'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/measure-api.mjs <base-url> [--cpu] [--samples N] [--login-samples N]')
  process.exit(2)
}
const flag = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? Number(process.argv[i + 1]) : fallback
}
const SAMPLES = flag('--samples', 40)
const LOGIN_SAMPLES = flag('--login-samples', 27)
const wantCpu = process.argv.includes('--cpu')
const email = process.env.MEASURE_EMAIL
const password = process.env.MEASURE_PASSWORD
if (!email || !password) {
  console.error('set MEASURE_EMAIL and MEASURE_PASSWORD')
  process.exit(2)
}

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]

/** Total CPU milliseconds used so far by every workerd process (Linux only; 100 ticks a second). */
function workerdCpuMs() {
  let ticks = 0
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('workerd')) continue
      const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
      ticks += Number(f[11]) + Number(f[12])
    } catch {
      /* process ended */
    }
  }
  return ticks * 10
}

/** Idle CPU of the workerd processes in ms per second, measured once: dev mode has watchers and an inspector, so it is not zero. */
async function idleRate() {
  if (!wantCpu) return 0
  const a = workerdCpuMs()
  const t = performance.now()
  await new Promise((r) => setTimeout(r, 5000))
  return (workerdCpuMs() - a) / ((performance.now() - t) / 1000)
}
const idle = await idleRate()

async function call(path, init = {}) {
  const t = performance.now()
  const res = await fetch(base + path, init)
  await res.arrayBuffer()
  return { ms: performance.now() - t, res }
}

async function scenario(name, n, run) {
  const walls = []
  const cpu0 = wantCpu ? workerdCpuMs() : 0
  const t0 = performance.now()
  for (let i = 0; i < n; i++) walls.push(await run(i))
  const cpu = wantCpu ? Math.max(0, workerdCpuMs() - cpu0 - idle * ((performance.now() - t0) / 1000)) / n : null
  console.log(`${name.padEnd(34)} n=${String(n).padStart(3)}  wall p50 ${pct(walls, 50).toFixed(0).padStart(5)} ms  p99 ${pct(walls, 99).toFixed(0).padStart(5)} ms${cpu === null ? '' : `  cpu avg ${cpu.toFixed(1)} ms`}`)
}

const ok = (r, want = 200) => {
  if (r.res.status !== want) throw new Error(`unexpected ${r.res.status} (wanted ${want}) from ${r.res.url}`)
  return r.ms
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// cold-ish: the very first request this process makes
console.log(`target ${base}${wantCpu ? `  (idle workerd CPU ${idle.toFixed(0)} ms per second, subtracted)` : ''}`)
console.log(`first request (cold start if the Worker was idle): ${ok(await call('/api/v1/health')).toFixed(0)} ms`)

await scenario('health (one database ping)', SAMPLES, async () => ok(await call('/api/v1/health')))
await scenario('public read: settings', SAMPLES, async () => ok(await call('/api/v1/public/settings')))
await scenario('public read: sections', SAMPLES, async () => ok(await call('/api/v1/public/sections')))
await scenario('public read: posts (page 1)', SAMPLES, async () => ok(await call('/api/v1/public/posts')))
await scenario('captcha (limit 30 a minute)', Math.min(SAMPLES, 25), async () => ok(await call('/api/v1/public/captcha', { headers: { 'CF-Connecting-IP': '198.51.100.7' } })))

// login: 9 per minute window (limit 10 per IP and per email)
const logins = []
let token = ''
{
  const cpu0 = wantCpu ? workerdCpuMs() : 0
  let busyMs = 0
  for (let i = 0; i < LOGIN_SAMPLES; i++) {
    if (i > 0 && i % 9 === 0) await sleep(61_000)
    const r = await call('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    if (r.res.status !== 200) throw new Error(`login failed: ${r.res.status}`)
    logins.push(r.ms)
    busyMs += r.ms
    if (!token) token = (await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.9' }, body: JSON.stringify({ email, password }) }).then((x) => x.json())).access_token
  }
  // idle CPU is subtracted for the time spent inside requests only (the waits between windows are excluded)
  const cpu = wantCpu ? Math.max(0, workerdCpuMs() - cpu0 - idle * (busyMs / 1000) - 0) / (LOGIN_SAMPLES + 1) : null
  console.log(`${'login (password check)'.padEnd(34)} n=${String(LOGIN_SAMPLES).padStart(3)}  wall p50 ${pct(logins, 50).toFixed(0).padStart(5)} ms  p99 ${pct(logins, 99).toFixed(0).padStart(5)} ms${cpu === null ? '' : `  cpu avg ${cpu.toFixed(1)} ms`}`)
}
const auth = { Authorization: `Bearer ${token}` }
await scenario('admin list: users (authenticated)', SAMPLES, async () => ok(await call('/api/v1/users', { headers: auth })))
await scenario('admin list: contact messages', SAMPLES, async () => ok(await call('/api/v1/contact-messages', { headers: auth })))
await scenario('me (token check + aggregate)', SAMPLES, async () => ok(await call('/api/v1/me', { headers: auth })))

// rate limits: a burst from one address must end in 429 with Retry-After
async function burst(path, init, count) {
  const seen = []
  for (let i = 0; i < count; i++) {
    const r = await call(path, init(i))
    seen.push(r.res.status)
    if (r.res.status === 429) return { first429: i + 1, retryAfter: r.res.headers.get('retry-after'), statuses: seen }
  }
  return { first429: null, retryAfter: null, statuses: seen }
}
await sleep(61_000) // a fresh window
const loginBurst = await burst('/api/v1/auth/login', (i) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20' }, body: JSON.stringify({ email: `nobody${i}@example.test`, password: 'wrong-password-123' }) }), 14)
console.log(`login burst (one IP, wrong password): first 429 at request ${loginBurst.first429}, Retry-After ${loginBurst.retryAfter}s (limit 10 a minute)`)
const contactBurst = await burst('/api/v1/contact', () => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.21' }, body: '{}' }), 9)
console.log(`contact burst (one IP): first 429 at request ${contactBurst.first429}, Retry-After ${contactBurst.retryAfter}s (limit 5 a minute by default)`)

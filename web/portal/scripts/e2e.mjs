// Smoke pipeline: fixture API -> next build -> finalize -> Playwright against the static server.
//   node scripts/e2e.mjs [playwright args]
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { startFixtureApi } from '../test/fixture-api.mjs'

const API_PORT = 4010
const SITE_PORT = 4173
const env = {
  ...process.env,
  // Run the package's own binaries directly (works with or without pnpm on the PATH).
  PATH: `${resolve('node_modules/.bin')}${delimiter}${process.env.PATH}`,
  NODE_ENV: 'production',
  BUILD_API_URL: `http://127.0.0.1:${API_PORT}/api`,
  SITE_URL: `http://127.0.0.1:${SITE_PORT}`,
  LOCALE_DEFAULT: 'en',
  LOCALE_SUPPORTED: 'en,bn',
  NEXT_PUBLIC_API_URL: '',
}

// Async on purpose: the fixture API lives in this process, and a blocking spawn would stop it answering the build.
const run = (command, args) =>
  new Promise((done) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('exit', (code) => done(code ?? 1))
  })

const server = await startFixtureApi(API_PORT)
rmSync('out', { recursive: true, force: true })

let code = await run('next', ['build'])
if (code === 0) code = await run('node', ['scripts/finalize-export.mjs'])
if (code === 0) code = await run('playwright', ['test', ...process.argv.slice(2)])
server.close()
process.exit(code)

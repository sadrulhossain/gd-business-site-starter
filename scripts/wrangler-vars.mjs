// Prints SITE_ORIGIN and LOCALE_* from the root wrangler.jsonc as KEY=value lines, for `>> "$GITHUB_ENV"` in deploy.yml.
// The Worker and the portal build read the same values, so there is no GitHub variable to keep in step.
// wrangler.jsonc must stay plain JSON (no comments).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const KEYS = ['SITE_ORIGIN', 'LOCALE_DEFAULT', 'LOCALE_FALLBACK', 'LOCALE_SUPPORTED']

export function readVars(text) {
  let config
  try {
    config = JSON.parse(text)
  } catch (e) {
    throw new Error(`wrangler.jsonc must be plain JSON, without comments: ${e.message}`)
  }
  const vars = config.vars ?? {}
  const out = {}
  for (const key of KEYS) {
    const value = vars[key]
    if (typeof value !== 'string' || value === '') throw new Error(`wrangler.jsonc vars.${key} is missing or empty`)
    if (/[\r\n]/.test(value)) throw new Error(`vars.${key} must be one line`)
    out[key] = value
  }
  if (!/^https:\/\/[^/\s]+$/.test(out.SITE_ORIGIN)) throw new Error('vars.SITE_ORIGIN must be an https origin without a path or trailing slash')
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const vars = readVars(readFileSync(process.argv[2] ?? 'wrangler.jsonc', 'utf8'))
    for (const [key, value] of Object.entries(vars)) console.log(`${key}=${value}`)
  } catch (e) {
    console.error(`wrangler-vars: ${e.message}`)
    process.exit(1)
  }
}

// Checks dist/site against the Workers Free static-asset limits (docs/LIMITS.md in M9; developers.cloudflare.com/workers/platform/limits):
// 20,000 files per version and 25 MiB per file. Fails above 80 percent of either; prints the media size and warns at 500 MB.
import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_FILES = 20000
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MEDIA_WARN_BYTES = 500 * 1000 * 1000
const SOFT = 0.8
const LEFTOVER = /(^|\/)_(headers|redirects)\.(portal|admin)$/

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

export function inspect(root) {
  let files = 0
  let mediaBytes = 0
  const big = []
  const leftovers = []
  for (const path of walk(root)) {
    const rel = relative(root, path).split('\\').join('/')
    const size = statSync(path).size
    files += 1
    if (rel.startsWith('media/')) mediaBytes += size
    if (size > MAX_FILE_BYTES * SOFT) big.push(`${rel} (${(size / 1048576).toFixed(1)} MiB)`)
    if (LEFTOVER.test(rel)) leftovers.push(rel)
  }
  return { files, mediaBytes, big, leftovers }
}

export function problems({ files, big, leftovers }) {
  const out = []
  if (files > MAX_FILES * SOFT) out.push(`${files} files; the limit is ${MAX_FILES} per version, and 80 percent is ${MAX_FILES * SOFT}`)
  for (const b of big) out.push(`file above 80 percent of 25 MiB: ${b}`)
  for (const l of leftovers) out.push(`${l} must not be uploaded as an asset (assemble-site.mjs merges it)`)
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? 'dist/site')
  const result = inspect(root)
  const mb = (result.mediaBytes / 1000 / 1000).toFixed(1)
  console.log(`check-assets: ${result.files} files of ${MAX_FILES}, media ${mb} MB`)
  if (result.mediaBytes >= MEDIA_WARN_BYTES) console.warn(`check-assets: WARNING media is ${mb} MB, above 500 MB; the repository and the build are getting heavy`)
  const bad = problems(result)
  for (const line of bad) console.error(`check-assets: ${line}`)
  process.exit(bad.length ? 1 : 0)
}

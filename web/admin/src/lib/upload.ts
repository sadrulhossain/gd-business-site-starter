import { ApiError } from '@gd/api-client'
import { getValidToken, refreshTokens } from '../auth/session'
import { config } from './config'

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** Browsers report .ico as either of these. Only the favicon accepts it. */
export const ICO_TYPES = ['image/x-icon', 'image/vnd.microsoft.icon']
/** Mirrors UPLOADS_MAX_MB for a quick message; the API stays the authority. */
export const MAX_IMAGE_MB = 5
/** Same cap as the API (MAX_PIXELS in api/src/media/service.ts), checked before the file is decoded. */
export const MAX_PIXELS = 36_000_000
/** Widths of the WebP variants; an image narrower than a width never gets that variant (no upscaling). */
export const TARGET_WIDTHS = [480, 960, 1600]
export const WEBP_QUALITY = 0.82

/** A message when the browser can already tell the file will be refused, else null. */
export function checkImage(file: { type: string; size: number }, allowIco = false): string | null {
  if (!IMAGE_TYPES.includes(file.type) && !(allowIco && ICO_TYPES.includes(file.type))) return allowIco ? 'Only ICO, JPEG, PNG or WebP images' : 'Only JPEG, PNG or WebP images'
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) return `Larger than ${MAX_IMAGE_MB} MB`

  return null
}

/** Widths to encode for an image `width` pixels wide: every target that fits, or just the original width when it is below the smallest. */
export function planWidths(width: number): number[] {
  const fits = TARGET_WIDTHS.filter((w) => w <= width)

  return fits.length ? fits : [width]
}

/** Height of a variant, keeping the aspect ratio. */
export const scaledHeight = (width: number, height: number, to: number) => Math.max(1, Math.round((height * to) / width))

/** Message when the pixel count is too high, else null. */
export function checkPixels(width: number, height: number): string | null {
  if (!(width > 0 && height > 0)) return 'Could not read the image size'

  return width * height > MAX_PIXELS ? 'The image has too many pixels (36 megapixels at most)' : null
}

/** Reads width and height from the file header (PNG, JPEG, WebP) without decoding it; null for anything else. */
export function readDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const u32 = (o: number) => ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0
  const le24 = (o: number) => bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16)
  const ascii = (o: number, s: string) => [...s].every((c, i) => bytes[o + i] === c.charCodeAt(0))

  if (bytes.length > 24 && bytes[0] === 0x89 && ascii(1, 'PNG')) return { width: u32(16), height: u32(20) }

  if (bytes.length > 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) return { width: le24(24) + 1, height: le24(27) + 1 }
    if (ascii(12, 'VP8L')) {
      const b = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
      return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 }
    }
    if (ascii(12, 'VP8 ')) return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff }
    return null
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return null
      const marker = bytes[o + 1]!
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: (bytes[o + 5]! << 8) | bytes[o + 6]!, width: (bytes[o + 7]! << 8) | bytes[o + 8]! }
      o += 2 + ((bytes[o + 2]! << 8) | bytes[o + 3]!)
    }
  }

  return null
}

export class UploadError extends Error {}

export interface Variants {
  blobs: Blob[]
  width: number
  height: number
}

/** Draws `bitmap` at `width` on an OffscreenCanvas (or a canvas element where that is missing) and encodes WebP. */
async function encode(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  let blob: Blob | null
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
    blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY })
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY))
  }
  // A browser that cannot encode WebP silently returns PNG.
  if (!blob || blob.type !== 'image/webp') throw new UploadError('This browser cannot create WebP images. Use a current Chrome, Edge, Firefox or Safari.')

  return blob
}

/** Checks the size and pixel cap before decoding, then builds the WebP variants. The original file is never sent. */
export async function makeVariants(file: File): Promise<Variants> {
  const problem = checkImage(file)
  if (problem) throw new UploadError(problem)

  const dims = readDimensions(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()))
  if (!dims) throw new UploadError('Could not read the image size')
  const tooBig = checkPixels(dims.width, dims.height)
  if (tooBig) throw new UploadError(tooBig)

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new UploadError('This image could not be opened')
  })
  try {
    const blobs: Blob[] = []
    for (const w of planWidths(bitmap.width)) blobs.push(await encode(bitmap, w, scaledHeight(bitmap.width, bitmap.height, w)))

    return { blobs, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

export interface UploadDeps {
  createXhr: () => XMLHttpRequest
  token: () => Promise<string | null>
  refresh: () => Promise<boolean>
  baseUrl: () => string
}

const defaults: UploadDeps = { createXhr: () => new XMLHttpRequest(), token: getValidToken, refresh: refreshTokens, baseUrl: config.apiBase }

type Options = { deps?: UploadDeps; retried?: boolean }

/**
 * POST a multipart body with upload progress (fetch cannot report it). Resolves with the parsed JSON body.
 * A 401 refreshes the token once and retries; other failures throw ApiError like the API client does.
 */
export function uploadForm(path: string, form: FormData, onProgress: (fraction: number) => void, { deps = defaults, retried = false }: Options = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    void deps.token().then((token) => {
      const xhr = deps.createXhr()
      xhr.open('POST', deps.baseUrl().replace(/\/+$/, '') + path)
      xhr.withCredentials = true
      xhr.setRequestHeader('Accept', 'application/json')
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
      }
      xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Network error'))
      xhr.onload = () => {
        if (xhr.status === 401 && !retried) {
          void deps.refresh().then((renewed) => {
            if (!renewed) return reject(new ApiError(401, 'unauthenticated', 'Unauthenticated'))
            uploadForm(path, form, onProgress, { deps, retried: true }).then(resolve, reject)
          })
          return
        }

        let body: unknown
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          body = undefined
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1)
          return resolve(body)
        }

        const error = (body as { error?: { code?: string; message?: string; details?: Record<string, string[]> } } | undefined)?.error
        reject(new ApiError(xhr.status, error?.code ?? 'http_error', error?.message ?? xhr.statusText, error?.details))
      }

      xhr.send(form)
    }, reject)
  })
}

/** One file as multipart field `field` (the favicon, which has no variants). */
export function uploadFile(path: string, file: File, onProgress: (fraction: number) => void, { field = 'image', ...options }: Options & { field?: string } = {}): Promise<unknown> {
  const form = new FormData()
  form.append(field, file)

  return uploadForm(path, form, onProgress, options)
}

/**
 * The M3 contract: WebP variants (field `variants`, repeated) plus the original `width` and `height` in one request.
 * `plain` sends the file as it is (favicon).
 */
export async function uploadImage(path: string, file: File, onProgress: (fraction: number) => void, { plain = false, onPreview, ...options }: Options & { plain?: boolean; onPreview?: (image: Blob) => void } = {}): Promise<unknown> {
  if (plain) {
    onPreview?.(file)
    return uploadFile(path, file, onProgress, options)
  }

  const { blobs, width, height } = await makeVariants(file)
  onPreview?.(blobs[blobs.length - 1]!)
  const form = new FormData()
  blobs.forEach((blob, i) => form.append('variants', blob, `${i}.webp`))
  form.append('width', String(width))
  form.append('height', String(height))

  return uploadForm(path, form, onProgress, options)
}

/** Message for a failed upload: the first 422 field message, the browser-side reason, or a plain sentence. */
export function uploadMessage(error: unknown): string {
  if (error instanceof UploadError) return error.message
  if (error instanceof ApiError && error.status === 422) return Object.values(error.details ?? {})[0]?.[0] ?? error.message

  return 'Could not upload the image'
}

/** Runs `worker` over `items` with at most `limit` in flight. Never rejects: worker errors are the worker's to record. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lane = async () => {
    while (next < items.length) await worker(items[next++]!)
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
}

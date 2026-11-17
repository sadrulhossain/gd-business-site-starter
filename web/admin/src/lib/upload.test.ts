import { describe, expect, it, vi } from 'vitest'
import { checkImage, checkPixels, MAX_PIXELS, planWidths, readDimensions, scaledHeight, uploadImage, UploadError, type UploadDeps } from './upload'

describe('variant sizing (no canvas needed)', () => {
  it('encodes every target width that fits, never upscaling', () => {
    expect(planWidths(4000)).toEqual([480, 960, 1600])
    expect(planWidths(1600)).toEqual([480, 960, 1600])
    expect(planWidths(1599)).toEqual([480, 960])
    expect(planWidths(960)).toEqual([480, 960])
    expect(planWidths(500)).toEqual([480])
  })

  it('keeps the original width when the image is narrower than the smallest target', () => {
    expect(planWidths(300)).toEqual([300])
    expect(planWidths(1)).toEqual([1])
  })

  it('keeps the aspect ratio', () => {
    expect(scaledHeight(2000, 1000, 960)).toBe(480)
    expect(scaledHeight(3, 1, 480)).toBe(160)
    expect(scaledHeight(10_000, 1, 480)).toBe(1)
  })

  it('rejects more than 36 million pixels and unreadable sizes', () => {
    expect(MAX_PIXELS).toBe(36_000_000)
    expect(checkPixels(6000, 6000)).toBeNull()
    expect(checkPixels(6001, 6000)).toMatch(/too many pixels/)
    expect(checkPixels(0, 10)).toMatch(/Could not read/)
  })

  it('rejects wrong types and files over the size cap before any decoding', () => {
    expect(checkImage({ type: 'image/gif', size: 10 })).toMatch(/JPEG, PNG or WebP/)
    expect(checkImage({ type: 'image/png', size: 6 * 1024 * 1024 })).toMatch(/Larger than 5 MB/)
    expect(checkImage({ type: 'image/png', size: 1024 })).toBeNull()
    expect(checkImage({ type: 'image/x-icon', size: 1024 }, true)).toBeNull()
  })
})

describe('readDimensions (file header only)', () => {
  const bytes = (...n: number[]) => Uint8Array.from(n)
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

  it('reads PNG', () => {
    const png = bytes(0x89, ...ascii('PNG'), 13, 10, 26, 10, 0, 0, 0, 13, ...ascii('IHDR'), 0, 0, 0x07, 0xd0, 0, 0, 0x03, 0xe8, 8, 2, 0, 0, 0)
    expect(readDimensions(png)).toEqual({ width: 2000, height: 1000 })
  })

  it('reads JPEG (SOF0 after another segment)', () => {
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x03, 0xe8, 0x07, 0xd0, 3, 1, 0x22, 0)
    expect(readDimensions(jpeg)).toEqual({ width: 2000, height: 1000 })
  })

  it('reads lossy, lossless and extended WebP', () => {
    const riff = (chunk: string, body: number[]) => bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0, ...body, ...new Array<number>(20).fill(0))
    expect(readDimensions(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0xd0, 0x07, 0xe8, 0x03]))).toEqual({ width: 2000, height: 1000 })
    expect(readDimensions(riff('VP8X', [0, 0, 0, 0, 0xcf, 0x07, 0, 0xe7, 0x03, 0]))).toEqual({ width: 2000, height: 1000 })
    const packed = ((2000 - 1) | ((1000 - 1) << 14)) >>> 0
    expect(readDimensions(riff('VP8L', [0x2f, packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, (packed >>> 24) & 255]))).toEqual({ width: 2000, height: 1000 })
  })

  it('returns null for anything else', () => {
    expect(readDimensions(bytes(1, 2, 3))).toBeNull()
    expect(readDimensions(new Uint8Array(100))).toBeNull()
  })
})

describe('uploadImage', () => {
  function deps() {
    const sent: { form?: FormData; credentials?: boolean }[] = []
    const xhr = {
      status: 200,
      statusText: '',
      responseText: '{"data":{}}',
      withCredentials: false,
      upload: {},
      onload: undefined as undefined | (() => void),
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send(form: FormData) {
        sent.push({ form, credentials: xhr.withCredentials })
        xhr.onload?.()
      },
    }
    const d: UploadDeps = { createXhr: () => xhr as unknown as XMLHttpRequest, token: async () => 't', refresh: async () => true, baseUrl: () => '/api' }

    return { d, sent }
  }

  it('sends the favicon file as it is, in the image field, with credentials', async () => {
    const { d, sent } = deps()
    const file = new File(['ico'], 'f.ico', { type: 'image/x-icon' })
    await uploadImage('/v1/settings/favicon', file, () => undefined, { plain: true, deps: d })

    expect(sent[0]!.form!.get('image')).toBeInstanceOf(File)
    expect(sent[0]!.credentials).toBe(true)
  })

  it('refuses an oversized file without sending anything', async () => {
    const { d, sent } = deps()
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'a.png', { type: 'image/png' })
    await expect(uploadImage('/p', big, () => undefined, { deps: d })).rejects.toBeInstanceOf(UploadError)
    expect(sent).toHaveLength(0)
  })
})

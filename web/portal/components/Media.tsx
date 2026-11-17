import type { Media } from '../lib/api'

/**
 * An upload as <img> with a srcset built from the record's variants (`webp`: width => URL, the M3 contract), never from
 * guessed file names. Without variants only the original is used. `width` and `height` (the original size, when the
 * record has them) reserve the layout box so lazy loading does not shift the page. Alt is empty unless given: these are decorative by default.
 */
export function Picture({ image, alt = '', className, sizes = '(min-width: 768px) 33vw, 100vw', loading = 'lazy' }: { image: Media; alt?: string; className?: string; sizes?: string; loading?: 'lazy' | 'eager' }) {
  const srcSet = Object.entries(image.webp ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([width, url]) => `${url} ${width}w`)
    .join(', ')

  // eslint-disable-next-line @next/next/no-img-element -- static export: the browser already made the resized WebP files.
  return <img src={image.url} srcSet={srcSet || undefined} sizes={srcSet ? sizes : undefined} width={image.width ?? undefined} height={image.height ?? undefined} alt={alt} loading={loading} decoding="async" className={className} />
}

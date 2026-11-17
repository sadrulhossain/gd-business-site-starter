import { notFound } from 'next/navigation'

/**
 * Exists only to be rendered as a 404 inside the locale layout (header, footer, localised text).
 * scripts/finalize-export.mjs copies its HTML to out/404.html and deletes this folder from the export.
 */
export default function NotFoundSource(): never {
  notFound()
}

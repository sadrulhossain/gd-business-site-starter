import type { MetadataRoute } from 'next'
import { getAllPosts, getAllServices, getSections } from '../lib/api'
import { blogRoutes, blogPath } from '../lib/blog-page'
import { defaultLocale, localePath, locales } from '../lib/i18n'
import { SECTION_PAGES } from '../lib/section-page'
import { absolute } from '../lib/seo'

export const dynamic = 'force-static'

/**
 * Every page the export generates, in every locale, each with its hreflang alternates, at its final URL (with the
 * trailing slash). Pages that come from a section are listed only while that section is visible.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sections = await getSections(defaultLocale)
  const services = sections.some((s) => s.key === 'services') ? await getAllServices(defaultLocale) : []
  const posts = await getAllPosts(defaultLocale)
  const lists = (await blogRoutes()).filter((r) => r.locale === defaultLocale)

  const paths: { path: string; modified?: string }[] = [
    { path: '/' },
    ...sections.flatMap((s) => (SECTION_PAGES[s.key] ? [{ path: SECTION_PAGES[s.key]! }] : [])),
    ...lists.map(({ category, page }) => ({ path: blogPath({ category, page }) })),
    { path: '/contact' },
    { path: '/privacy' },
    { path: '/terms' },
    ...services.map((s) => ({ path: `/services/${s.id}` })),
    ...posts.map((p) => ({ path: `/blog/${p.slug}`, modified: p.updated_at })),
  ]

  return paths.flatMap(({ path, modified }) =>
    locales.map((locale) => ({
      url: absolute(localePath(locale, path)),
      lastModified: modified ? new Date(modified) : undefined,
      alternates: { languages: Object.fromEntries(locales.map((code) => [code, absolute(localePath(code, path))])) },
    })),
  )
}

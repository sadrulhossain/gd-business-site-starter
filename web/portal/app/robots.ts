import type { MetadataRoute } from 'next'
import { absolute } from '../lib/seo'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    // /api/ and /admin/ are served by the same Worker but are not pages.
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] },
    sitemap: absolute('/sitemap.xml'),
  }
}

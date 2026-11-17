import { BlogListing, blogMetadata, blogRoutes } from '../../../../../lib/blog-page'
import { locales, orSentinel, SENTINEL_PAGE } from '../../../../../lib/i18n'

type Props = { params: Promise<{ locale: string; page: string }> }

export const dynamicParams = false

/** /blog/page/2/ ... for every locale; page 1 is /blog/. */
export async function generateStaticParams() {
  const routes = (await blogRoutes()).filter((r) => !r.category && r.page > 1)

  return locales.flatMap((locale) => orSentinel(routes.filter((r) => r.locale === locale).map((r) => ({ locale, page: String(r.page) })), { locale, page: SENTINEL_PAGE }))
}

export const generateMetadata = async ({ params }: Props) => {
  const { locale, page } = await params
  return blogMetadata({ locale, page: Number(page) })
}

export default async function BlogPage({ params }: Props) {
  const { locale, page } = await params
  return <BlogListing locale={locale} page={Number(page)} />
}

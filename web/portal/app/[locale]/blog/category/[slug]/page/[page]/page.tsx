import { BlogListing, blogMetadata, blogRoutes } from '../../../../../../../lib/blog-page'
import { locales, orSentinel, SENTINEL, SENTINEL_PAGE } from '../../../../../../../lib/i18n'

type Props = { params: Promise<{ locale: string; slug: string; page: string }> }

export const dynamicParams = false

/** /blog/category/<slug>/page/2/ ... */
export async function generateStaticParams() {
  const routes = (await blogRoutes()).filter((r) => r.category && r.page > 1)

  return locales.flatMap((locale) => orSentinel(routes.filter((r) => r.locale === locale).map((r) => ({ locale, slug: r.category!, page: String(r.page) })), { locale, slug: SENTINEL, page: SENTINEL_PAGE }))
}

export const generateMetadata = async ({ params }: Props) => {
  const { locale, slug, page } = await params
  return blogMetadata({ locale, category: slug, page: Number(page) })
}

export default async function BlogCategoryPage({ params }: Props) {
  const { locale, slug, page } = await params
  return <BlogListing locale={locale} category={slug} page={Number(page)} />
}

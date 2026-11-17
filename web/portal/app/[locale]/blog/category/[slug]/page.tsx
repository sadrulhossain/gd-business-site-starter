import { BlogListing, blogMetadata, blogRoutes } from '../../../../../lib/blog-page'
import { locales, orSentinel, SENTINEL } from '../../../../../lib/i18n'

type Props = { params: Promise<{ locale: string; slug: string }> }

export const dynamicParams = false

/** /blog/category/<slug>/ for every locale and category. */
export async function generateStaticParams() {
  const routes = (await blogRoutes()).filter((r) => r.category && r.page === 1)

  return locales.flatMap((locale) => orSentinel(routes.filter((r) => r.locale === locale).map((r) => ({ locale, slug: r.category! })), { locale, slug: SENTINEL }))
}

export const generateMetadata = async ({ params }: Props) => {
  const { locale, slug } = await params
  return blogMetadata({ locale, category: slug, page: 1 })
}

export default async function BlogCategory({ params }: Props) {
  const { locale, slug } = await params
  return <BlogListing locale={locale} category={slug} page={1} />
}

import { BlogListing, blogMetadata } from '../../../lib/blog-page'

type Props = { params: Promise<{ locale: string }> }

export const generateMetadata = async ({ params }: Props) => blogMetadata({ locale: (await params).locale, page: 1 })

export default async function BlogIndex({ params }: Props) {
  return <BlogListing locale={(await params).locale} page={1} />
}

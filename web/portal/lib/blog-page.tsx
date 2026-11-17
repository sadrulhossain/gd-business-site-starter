import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Picture } from '../components/Media'
import { DefaultMark } from '../components/SiteLogo'
import { defaultLocale, getMessages, isLocale, localePath, locales } from './i18n'
import { getCategories, getPosts, getSettings } from './api'
import { pageMetadata } from './seo'

/** Final path of a blog list: /blog/, /blog/page/2/, /blog/category/<slug>/, /blog/category/<slug>/page/2/. */
export const blogPath = ({ category, page = 1 }: { category?: string; page?: number } = {}) =>
  `/blog${category ? `/category/${category}` : ''}${page > 1 ? `/page/${page}` : ''}`

/** Every list page of every locale, built from the API's pagination meta (last_page): `{ locale, category?, page }`. */
export async function blogRoutes(): Promise<{ locale: string; category?: string; page: number }[]> {
  const categories = await getCategories(defaultLocale)
  const lists: (string | undefined)[] = [undefined, ...categories.map((c) => c.slug)]
  const counts = await Promise.all(lists.map(async (category) => ({ category, last: (await getPosts(defaultLocale, { category })).lastPage })))

  return locales.flatMap((locale) => counts.flatMap(({ category, last }) => Array.from({ length: last }, (_, i) => ({ locale, category, page: i + 1 }))))
}

const link = (locale: string, list: { category?: string; page?: number }) => localePath(locale, blogPath(list))

export async function blogMetadata({ locale, category, page }: { locale: string; category?: string; page: number }): Promise<Metadata> {
  if (!isLocale(locale)) return {}
  const [settings, categories] = await Promise.all([getSettings(locale), getCategories(locale)])
  const messages = getMessages(locale)
  const name = categories.find((c) => c.slug === category)?.name
  const title = `${name ?? messages.blog.title}${page > 1 ? ` (${page})` : ''}`

  // Each list page is its own URL now, so each one canonicalises to itself.
  return pageMetadata({ locale, path: blogPath({ category, page }), siteName: settings.site_name, title, description: messages.blog.intro })
}

/** One page of the blog list, optionally of one category. An unknown category or a page past the end is a 404. */
export async function BlogListing({ locale, category, page }: { locale: string; category?: string; page: number }) {
  if (!isLocale(locale) || !(page >= 1)) notFound()

  const t = getMessages(locale).blog
  const categories = await getCategories(locale)
  if (category && !categories.some((c) => c.slug === category)) notFound()
  const { posts, lastPage } = await getPosts(locale, { page, category })
  if (page > lastPage) notFound()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' })

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{t.title}</h1>
      <p className="mt-2 text-ink-muted">{t.intro}</p>

      {categories.length > 0 && (
        <nav aria-label={t.categories} className="mt-6 flex flex-wrap gap-2">
          <Link href={link(locale, {})} aria-current={!category ? 'true' : undefined} className={`rounded-full px-4 py-1.5 ${!category ? 'bg-brand-700 text-white' : 'border border-line hover:bg-brand-50'}`}>
            {t.all}
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={link(locale, { category: c.slug })}
              aria-current={category === c.slug ? 'true' : undefined}
              className={`rounded-full px-4 py-1.5 ${category === c.slug ? 'bg-brand-700 text-white' : 'border border-line hover:bg-brand-50'}`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      {posts.length === 0 ? (
        <p className="mt-10 text-ink-muted">{t.empty}</p>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <li key={post.id} className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift">
              {post.image ? (
                <Picture image={post.image} className="aspect-[3/2] w-full object-cover" />
              ) : (
                <div aria-hidden="true" className="flex aspect-[3/2] w-full items-center justify-center bg-gradient-to-br from-brand-100 via-brand-50 to-accent-300/40">
                  <DefaultMark className="size-14 opacity-40 grayscale-[30%]" />
                </div>
              )}
              <div className="flex flex-1 flex-col gap-2 p-5">
                <p className="text-sm text-ink-muted">
                  {post.category && <span>{post.category.name} · </span>}
                  {post.published_at && <time dateTime={post.published_at}>{date.format(new Date(post.published_at))}</time>}
                </p>
                <h2 className="text-xl font-semibold">
                  <Link href={localePath(locale, `/blog/${post.slug}`)} className="hover:text-brand-700 hover:underline">
                    {post.title}
                  </Link>
                </h2>
                {post.excerpt && <p className="text-ink-muted">{post.excerpt}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label={t.pagination} className="mt-10 flex items-center justify-between gap-4">
          {page > 1 ? (
            <Link href={link(locale, { category, page: page - 1 })} rel="prev" className="rounded-full border border-line px-5 py-2.5 font-medium hover:bg-brand-50">
              <span aria-hidden="true">←</span> {t.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">{t.pageOf.replace('{page}', String(page)).replace('{last}', String(lastPage))}</span>
          {page < lastPage ? (
            <Link href={link(locale, { category, page: page + 1 })} rel="next" className="rounded-full border border-line px-5 py-2.5 font-medium hover:bg-brand-50">
              {t.next} <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  )
}

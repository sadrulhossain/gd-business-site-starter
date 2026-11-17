import { ApiError, createClient } from '@gd/api-client'
import { defaultLocale } from './i18n'

/**
 * Build-time API access. The portal is a static export: every public read happens once, during `next build`, against
 * BUILD_API_URL (the absolute address of the live Worker, including /api). Nothing here runs in the browser, and
 * BUILD_API_URL is never read by client code, so it cannot reach the bundle.
 *
 * A broken API must never publish an empty site: each request is retried (3 attempts, backoff) and then the build fails
 * with a message that names the URL and the reason.
 */
export const ATTEMPTS = 3
export const BACKOFF_MS = 500

export function buildApiUrl(): string {
  const url = process.env.BUILD_API_URL
  if (!url) throw new Error('BUILD_API_URL is not set. Point it at the live API, e.g. https://example.com/api (see web/portal/README.md).')

  return url.replace(/\/+$/, '')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** fetch with up to ATTEMPTS tries. 4xx answers are final (a 404 is a normal "no such page"); network errors and 5xx are retried. */
export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, { attempts = ATTEMPTS, backoff = BACKOFF_MS, doFetch = fetch }: { attempts?: number; backoff?: number; doFetch?: typeof fetch } = {}): Promise<Response> {
  let reason = ''
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await doFetch(input, init)
      if (response.status < 500) return response
      reason = `HTTP ${response.status}`
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
    if (attempt < attempts) await sleep(backoff * 2 ** (attempt - 1))
  }

  throw new Error(`Build stopped: the API request ${String(input)} failed after ${attempts} attempts (${reason}). Nothing was published; fix the API and build again.`)
}

/** One client per locale: `?lang=` makes the API return a single language per field (the second falls back to the first). */
export function apiFor(locale: string) {
  return createClient({
    baseUrl: buildApiUrl(),
    lang: locale === defaultLocale ? undefined : locale,
    fetch: (input, init) => fetchWithRetry(input, init),
  })
}

export interface Media {
  url: string
  /** Width => URL of each generated WebP variant (M3 contract). Empty when only the original exists. */
  webp: Record<string, string>
  width?: number | null
  height?: number | null
}

export interface Settings {
  site_name: string
  tagline: string | null
  logo?: Media | null
  currency?: string | null
  currency_symbol?: string | null
  favicon?: Media | null
  address: string | null
  phone: string | null
  email: string | null
  hours: Record<string, { open: string | null; close: string | null; closed: boolean }> | null
  social_links: Record<string, string | null>
}

export interface Section {
  id: number
  key: string
  title: string
  content: string | null
  image: Media | null
  sort_order: number
  is_visible: boolean
}

export interface Service {
  id: number
  title: string
  description: string | null
  image: Media | null
}

export interface Testimonial {
  id: number
  author_name: string
  author_role: string | null
  quote: string
  image: Media | null
}

export interface TeamMember {
  id: number
  name: string
  role: string
  bio: string | null
  image: Media | null
}

export interface GalleryItem {
  id: number
  title: string | null
  caption: string | null
  image: Media | null
}

export interface Pricing {
  id: number
  service_id: number
  service?: { id: number; title: string }
  name: string
  price: string
  unit: string | null
  description: string | null
  features: string | null
  is_featured: boolean
}

export interface Faq {
  id: number
  question: string
  answer: string
}

type Listing<T> = { data: T[] }

export async function getSettings(locale: string): Promise<Settings> {
  return ((await apiFor(locale).request('GET', '/v1/public/settings')) as { data: Settings }).data
}

/** Visible sections in display order. The API already filters; `is_visible` is checked again so a stale cache cannot show a hidden one. */
export async function getSections(locale: string): Promise<Section[]> {
  const rows = ((await apiFor(locale).request('GET', '/v1/public/sections')) as Listing<Section>).data

  return rows.filter((section) => section.is_visible)
}

export interface Category {
  id: number
  name: string
  slug: string
}

export interface Post {
  id: number
  title: string
  slug: string
  excerpt: string | null
  /** Sanitised HTML (the API sanitises on every write), safe to render as is. */
  body: string | null
  image: Media | null
  category: Category | null
  seo_title: string | null
  seo_description: string | null
  published_at: string | null
  updated_at: string
}

export interface PostPage {
  posts: Post[]
  page: number
  lastPage: number
}

/** One page of published posts (12 per page), optionally of one category. */
export async function getPosts(locale: string, { page = 1, category }: { page?: number; category?: string } = {}): Promise<PostPage> {
  const body = (await apiFor(locale).request('GET', '/v1/public/posts', { query: { page, category } })) as {
    data: Post[]
    meta?: { current_page: number; last_page: number }
  }

  return { posts: body.data, page: body.meta?.current_page ?? 1, lastPage: body.meta?.last_page ?? 1 }
}

/** One published post by slug; null when it is a draft, scheduled or gone. */
export async function getPost(locale: string, slug: string): Promise<Post | null> {
  try {
    return ((await apiFor(locale).request('GET', `/v1/public/posts/${encodeURIComponent(slug)}`)) as { data: Post }).data
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function getCategories(locale: string): Promise<Category[]> {
  return ((await apiFor(locale).request('GET', '/v1/public/categories')) as Listing<Category>).data
}

/** One visible service; null when it is hidden or gone (the API answers 404). */
export async function getService(locale: string, id: string): Promise<Service | null> {
  try {
    return ((await apiFor(locale).request('GET', `/v1/public/services/${encodeURIComponent(id)}`)) as { data: Service }).data
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** Visible prices of visible services, in service order; optionally those of one service. */
export async function getPricing(locale: string, serviceId?: number | string): Promise<Pricing[]> {
  const query = serviceId === undefined ? '' : `?service_id=${encodeURIComponent(String(serviceId))}`

  return ((await apiFor(locale).request('GET', `/v1/public/pricing${query}`)) as Listing<Pricing>).data
}

export async function getList<T>(locale: string, resource: 'services' | 'testimonials' | 'team' | 'gallery' | 'faqs'): Promise<T[]> {
  return ((await apiFor(locale).request('GET', `/v1/public/${resource}`)) as Listing<T>).data
}

/** Every published post (all pages of the API list), newest first. Only the build uses this: the sitemap and the post pages. */
export async function getAllPosts(locale: string): Promise<Post[]> {
  const first = await getPosts(locale)
  const rest = await Promise.all(Array.from({ length: first.lastPage - 1 }, (_, i) => getPosts(locale, { page: i + 2 })))

  return [first, ...rest].flatMap((page) => page.posts)
}

/** Every visible service (the API list is not paginated). */
export const getAllServices = (locale: string) => getList<Service>(locale, 'services')

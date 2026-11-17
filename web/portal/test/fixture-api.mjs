// A tiny stand-in for the public API, used by the smoke pipeline (scripts/e2e.mjs): `next build` reads it through
// BUILD_API_URL, so the test needs neither Mongo nor the Worker. Shapes follow the public resources (M3-M5).
import { createServer } from 'node:http'

const bn = (lang, text) => (lang === 'bn' ? `${text} (bn)` : text)
const stamp = '2026-01-01T00:00:00.000Z'
const section = (id, key, title, extra = {}) => ({ id, key, title, content: `${title} text`, image: null, sort_order: id, is_visible: true, ...extra })

const sections = [section(1, 'hero', 'Hero'), section(2, 'about', 'About'), section(3, 'services', 'Services'), section(4, 'pricing', 'Pricing'), section(5, 'gallery', 'Gallery'), section(6, 'faq', 'FAQ'), section(7, 'testimonials', 'Testimonials'), section(8, 'team', 'Team')]
const services = [1, 2, 3].map((id) => ({ id, title: `Service ${id}`, description: `About service ${id}`, image: null }))
const categories = [{ id: 1, name: 'News', slug: 'news' }, { id: 2, name: 'Tips', slug: 'tips' }]
// 13 posts in News (two pages of 12) and 1 in Tips, newest first.
const posts = Array.from({ length: 14 }, (_, i) => {
  const n = 14 - i
  const category = n === 1 ? categories[1] : categories[0]
  return { id: n, title: `Post ${n}`, slug: `post-${n}`, excerpt: `Excerpt ${n}`, body: `<p>Body ${n}</p>`, image: null, category, seo_title: null, seo_description: null, published_at: stamp, updated_at: stamp }
})

const page = (rows, url) => {
  const current = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const last = Math.max(1, Math.ceil(rows.length / 12))
  return { data: rows.slice((current - 1) * 12, current * 12), meta: { current_page: current, last_page: last, per_page: 12, total: rows.length } }
}

export function startFixtureApi(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const lang = url.searchParams.get('lang') ?? 'en'
    const path = url.pathname.replace(/^\/api\/v1\/public\//, '')
    const send = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const list = (rows) => send({ data: rows })
    const localised = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, bn(lang, r[k])])) }))

    if (req.url === '/__fail') return send({}, 500)
    if (path === 'settings') {
      return send({ data: { site_name: bn(lang, 'Fixture Co'), tagline: bn(lang, 'Always on'), logo: null, favicon: null, currency: 'USD', currency_symbol: '$', address: '1 Main St', phone: '+100000', email: 'hi@example.test', hours: null, social_links: {} } })
    }
    if (path === 'sections') return list(localised(sections, ['title', 'content']))
    if (path === 'services') return list(localised(services, ['title']))
    if (/^services\/\d+$/.test(path)) {
      const found = services.find((s) => s.id === Number(path.split('/')[1]))
      return found ? send({ data: localised([found], ['title'])[0] }) : send({ error: { code: 'not_found', message: 'Not found' } }, 404)
    }
    if (path === 'pricing') return list([{ id: 1, service_id: 1, name: 'Basic', price: '10.00', unit: null, description: null, features: null, is_featured: false }])
    if (path === 'faqs') return list([{ id: 1, question: 'Q1?', answer: 'A1' }])
    if (path === 'testimonials') return list([{ id: 1, author_name: 'Ann', author_role: null, quote: 'Great', image: null }])
    if (path === 'team') return list([{ id: 1, name: 'Bob', role: 'Lead', bio: null, image: null }])
    if (path === 'gallery') return list([])
    if (path === 'categories') return list(categories)
    if (path === 'posts') {
      const category = url.searchParams.get('category')
      return send(page(category ? posts.filter((p) => p.category.slug === category) : posts, url))
    }
    if (path.startsWith('posts/')) {
      const found = posts.find((p) => p.slug === path.slice(6))
      return found ? send({ data: { ...found, title: bn(lang, found.title) } }) : send({ error: { code: 'not_found', message: 'Not found' } }, 404)
    }
    return send({ error: { code: 'not_found', message: 'Not found' } }, 404)
  })

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startFixtureApi(Number(process.argv[2] ?? 4010))
  console.log('fixture api ready')
}

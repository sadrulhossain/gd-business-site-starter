import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Served by the single Worker under /admin/ (M8 copies dist/ to dist/site/admin/).
  base: '/admin/',
  server: {
    host: '0.0.0.0',
    port: Number(process.env.ADMIN_DEV_PORT || 28301),
    strictPort: true,
    // Development: /api goes to the Worker (wrangler dev) so the page and the API share an origin, as in production.
    proxy: { '/api': `http://localhost:${process.env.API_DEV_PORT || 28302}` },
    watch: { usePolling: true },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})

/**
 * Where things live. VITE_API_URL is empty in production, so every call goes to /api/... on the same origin as
 * the page (the single Worker serves both); in development the Vite dev server proxies /api to the Worker.
 */
export const config = {
  apiBase: () => `${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}/api`,
}

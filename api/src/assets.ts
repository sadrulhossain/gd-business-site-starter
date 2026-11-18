/**
 * Static assets for /admin/*. wrangler.jsonc sends only /api/*, /admin/* (except /admin/assets/*) to the Worker first;
 * everything else (portal, /media/*, /admin/assets/*) is served by the assets layer without waking the Worker.
 * Here the admin single-page app gets its fallback: a path with no file extension and no asset serves /admin/.
 */
export const ADMIN_PREFIX = '/admin';

export const isAdminPath = (pathname: string): boolean => pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);

const hasExtension = (pathname: string): boolean => /\.[A-Za-z0-9]+$/.test(pathname.slice(pathname.lastIndexOf('/') + 1));

export async function serveAssets(request: Request, assets: Fetcher): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const url = new URL(request.url);
  const res = await assets.fetch(request);
  if (res.status !== 404 || hasExtension(url.pathname)) return res;
  // The asset handler redirects /admin/index.html to /admin/, so ask for the folder, without conditional headers.
  return assets.fetch(new Request(new URL(`${ADMIN_PREFIX}/`, url), { method: request.method }));
}

import { describe, expect, it } from 'vitest';
import { isAdminPath, serveAssets } from '../src/assets.ts';

/** Fake ASSETS binding: knows a few files, answers 404 for the rest, like not_found_handling "404-page". */
function fakeAssets(files: Record<string, string>) {
  const seen: string[] = [];
  const fetcher = {
    async fetch(input: Request | string | URL): Promise<Response> {
      const req = input instanceof Request ? input : new Request(input);
      const path = new URL(req.url).pathname;
      seen.push(path);
      if (path === '/admin/index.html') return Response.redirect(new URL('/admin/', req.url).href, 308);
      const body = files[path === '/admin/' ? '/admin/index.html' : path];
      return body === undefined ? new Response('not found page', { status: 404 }) : new Response(body, { status: 200 });
    },
    connect: () => {
      throw new Error('unused');
    },
  } as unknown as Fetcher;
  return { fetcher, seen };
}

const files = { '/admin/index.html': '<app>', '/admin/assets/app.js': 'js' };
const get = (path: string, init?: RequestInit) => new Request(`https://site.test${path}`, init);

describe('isAdminPath', () => {
  it('matches /admin and below, nothing else', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    expect(isAdminPath('/admin/users/3')).toBe(true);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isAdminPath('/api/v1/health')).toBe(false);
  });
});

describe('serveAssets', () => {
  it('serves an existing file as it is', async () => {
    const { fetcher } = fakeAssets(files);
    const res = await serveAssets(get('/admin/assets/app.js'), fetcher);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('js');
  });

  it('serves the app for a route with no file extension', async () => {
    const { fetcher, seen } = fakeAssets(files);
    const res = await serveAssets(get('/admin/users/42'), fetcher);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<app>');
    expect(seen).toEqual(['/admin/users/42', '/admin/']);
  });

  it('asks for the folder, never index.html (the asset handler redirects that)', async () => {
    const { fetcher, seen } = fakeAssets(files);
    await serveAssets(get('/admin/settings'), fetcher);
    expect(seen).not.toContain('/admin/index.html');
  });

  it('keeps a missing file with an extension a 404', async () => {
    const { fetcher, seen } = fakeAssets(files);
    const res = await serveAssets(get('/admin/assets/missing.js'), fetcher);
    expect(res.status).toBe(404);
    expect(seen).toEqual(['/admin/assets/missing.js']);
  });

  it('does not treat a dotted folder name as a file when the last segment has no extension', async () => {
    const { fetcher } = fakeAssets(files);
    const res = await serveAssets(get('/admin/v1.2/users'), fetcher);
    expect(res.status).toBe(200);
  });

  it('passes a redirect through', async () => {
    const { fetcher } = fakeAssets(files);
    const res = await serveAssets(get('/admin/index.html'), fetcher);
    expect(res.status).toBe(308);
  });

  it('refuses methods other than GET and HEAD', async () => {
    const { fetcher, seen } = fakeAssets(files);
    const res = await serveAssets(get('/admin/users', { method: 'POST', body: 'x' }), fetcher);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
    expect(seen).toEqual([]);
  });
});

import { vi } from 'vitest';

/** Minimal valid WebP headers (VP8X and VP8L) with a body of `extra` bytes. */
export function webp(width: number, height: number, extra = 0, kind: 'vp8x' | 'vp8l' = 'vp8x'): Buffer {
  const body = Buffer.alloc(18 + extra);
  if (kind === 'vp8x') {
    body.writeUInt32LE(10, 0); // chunk size
    body.writeUIntLE(width - 1, 8, 3);
    body.writeUIntLE(height - 1, 11, 3);
  } else {
    body.writeUInt32LE(10 + extra, 0);
    body[4] = 0x2f;
    body.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 5);
  }
  const fourcc = kind === 'vp8x' ? 'VP8X' : 'VP8L';
  const head = Buffer.alloc(12);
  head.write('RIFF', 0);
  head.writeUInt32LE(4 + 4 + body.length, 4);
  head.write('WEBP', 8);
  return Buffer.concat([head, Buffer.from(fourcc), body]);
}

export const png = (width = 16, height = 16): Buffer => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};
export const ico = (): Buffer => Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0]);
export const jpeg = (): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

/** In-memory stand-in for the GitHub Git Data API (blobs, trees, commits, one branch ref). */
export function fakeGithub(initialFiles: string[] = []) {
  let n = 0;
  const trees = new Map<string, Set<string>>([['t0', new Set(initialFiles)]]);
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>([['c0', { tree: 't0', parents: [], message: 'init' }]]);
  const state = { head: 'c0', failRefUpdates: 0, failWith: 0, calls: [] as { method: string; path: string }[] };

  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const path = u.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    state.calls.push({ method, path });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (state.failWith) return reply({ message: 'boom' }, state.failWith);

    if (method === 'POST' && path === '/git/blobs') return reply({ sha: `b${++n}` }, 201);
    if (method === 'GET' && path.startsWith('/git/ref/heads/')) return reply({ object: { sha: state.head } });
    if (method === 'GET' && path.startsWith('/git/commits/')) return reply({ tree: { sha: commits.get(path.split('/').pop()!)!.tree } });
    if (method === 'POST' && path === '/git/trees') {
      const files = new Set(trees.get(body.base_tree)!);
      const blobs = new Map<string, string>();
      for (const e of body.tree as { path: string; sha: string | null }[]) {
        if (e.sha === null) files.delete(e.path);
        else files.add(e.path);
        blobs.set(e.path, e.sha ?? '');
      }
      const id = `t${++n}`;
      trees.set(id, files);
      return reply({ sha: id }, 201);
    }
    if (method === 'POST' && path === '/git/commits') {
      const id = `c${++n}`;
      commits.set(id, { tree: body.tree, parents: body.parents, message: body.message });
      return reply({ sha: id }, 201);
    }
    if (method === 'PATCH' && path.startsWith('/git/refs/heads/')) {
      if (state.failRefUpdates > 0) {
        state.failRefUpdates--;
        // someone else pushed first: the branch moves, so the update is not a fast-forward
        const id = `c${++n}`;
        commits.set(id, { tree: commits.get(state.head)!.tree, parents: [state.head], message: 'other push' });
        state.head = id;
        return reply({ message: 'Update is not a fast forward' }, 422);
      }
      if (commits.get(body.sha)!.parents[0] !== state.head) return reply({ message: 'Update is not a fast forward' }, 422);
      state.head = body.sha;
      return reply({ ref: 'refs/heads/main' });
    }
    return reply({ message: 'not mocked' }, 404);
  });

  return {
    fetch,
    state,
    files: () => [...trees.get(commits.get(state.head)!.tree)!].sort(),
    commitCount: () => state.calls.filter((c) => c.method === 'POST' && c.path === '/git/commits').length,
    messages: () => [...commits.values()].map((c) => c.message),
  };
}

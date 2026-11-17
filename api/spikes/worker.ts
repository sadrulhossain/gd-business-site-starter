// THROWAWAY spike Worker (Phase M1). Deleted after docs/SPIKES.md records the results.
import bcrypt from 'bcryptjs';
import { argon2id } from 'hash-wasm';
import mongoose from 'mongoose';

interface SpikeEnv {
  MONGODB_URI: string;
  MONGODB_DB: string;
  GITHUB_REPO?: string; // owner/name
  GITHUB_REPO_TOKEN?: string;
  SPIKE_BRANCH?: string; // scratch branch, default spike/media
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const PW = 'correct horse battery staple';

export default {
  async fetch(req: Request, env: SpikeEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const t0 = Date.now();
    try {
      // a. password hashing
      if (url.pathname === '/a/bcrypt') {
        const h = bcrypt.hashSync(PW, 10);
        return json({ alg: 'bcryptjs-10', ok: bcrypt.compareSync(PW, h), ms: Date.now() - t0 });
      }
      if (url.pathname === '/a/pbkdf2') {
        const iter = Number(url.searchParams.get('iter') ?? 100000);
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PW), 'PBKDF2', false, ['deriveBits']);
        const salt = crypto.getRandomValues(new Uint8Array(16));
        await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
        return json({ alg: 'pbkdf2-sha256', iter, ms: Date.now() - t0 });
      }
      if (url.pathname === '/a/argon2') {
        const m = Number(url.searchParams.get('m') ?? 19456);
        const t = Number(url.searchParams.get('t') ?? 2);
        await argon2id({ password: PW, salt: crypto.getRandomValues(new Uint8Array(16)), parallelism: 1, iterations: t, memorySize: m, hashLength: 32, outputType: 'hex' });
        return json({ alg: 'argon2id-wasm', m, t, ms: Date.now() - t0 });
      }
      // e. Atlas latency
      if (url.pathname === '/e/ping') {
        const conn = mongoose.createConnection(env.MONGODB_URI, { dbName: env.MONGODB_DB, maxPoolSize: 1, serverSelectionTimeoutMS: 3000 });
        await conn.asPromise();
        const tc = Date.now();
        await conn.db!.admin().ping();
        const body = { connectMs: tc - t0, pingMs: Date.now() - tc, totalMs: Date.now() - t0 };
        ctx.waitUntil(conn.close());
        return json(body);
      }
      // g. repository media
      if (url.pathname === '/g/upload' && req.method === 'POST') return await upload(req, env, t0);
      // h. routing probe
      if (url.pathname.startsWith('/api/')) return json({ route: 'api', path: url.pathname });
      return new Response('worker-fallback ' + url.pathname, { status: 404 });
    } catch (e) {
      return json({ error: String(e), ms: Date.now() - t0 }, 500);
    }
  },
};

const b64 = (buf: ArrayBuffer) => {
  let s = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

async function upload(req: Request, env: SpikeEnv, t0: number): Promise<Response> {
  const repo = env.GITHUB_REPO!;
  const branch = env.SPIKE_BRANCH ?? 'spike/media';
  let subrequests = 0;
  const gh = async (path: string, init?: RequestInit) => {
    subrequests++;
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env.GITHUB_REPO_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gd-spike', 'Content-Type': 'application/json' },
    });
    if (!r.ok && r.status !== 422) throw new Error(`${path} ${r.status} ${await r.text()}`);
    return r;
  };
  const form = await req.formData();
  const files = [...form.entries()].filter(([, v]) => typeof v !== 'string') as unknown as [string, File][];
  const id = crypto.randomUUID().slice(0, 8);
  const tree = [];
  for (const [name, f] of files) {
    const blob = (await (await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64(await f.arrayBuffer()), encoding: 'base64' }) })).json()) as { sha: string };
    tree.push({ path: `media/spike/${id}-${name}`, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    const ref = (await (await gh(`/git/ref/heads/${branch}`)).json()) as { object: { sha: string } };
    const head = ref.object.sha;
    const base = (await (await gh(`/git/commits/${head}`)).json()) as { tree: { sha: string } };
    const t = (await (await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree }) })).json()) as { sha: string };
    const c = (await (await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: `spike ${id}`, tree: t.sha, parents: [head] }) })).json()) as { sha: string };
    const up = await gh(`/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
    if (up.ok) return json({ id, files: files.length, attempts: attempt, subrequests, ms: Date.now() - t0 });
  }
  return json({ error: 'fast-forward retries exhausted', subrequests }, 409);
}

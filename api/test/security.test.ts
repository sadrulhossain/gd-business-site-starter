import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.ts';
import { drainDeferred } from '../src/runtime.ts';
import { seedAccess } from '../src/seed/seed.ts';
import { actingAs, actingAsSuperadmin, client, PASSWORD, testEnv, useDb } from './helpers.ts';
import { fakeGithub, png, webp } from './media-helpers.ts';

const db = useDb();
const { m } = db;
const api = client();
beforeAll(() => db.reset());
afterAll(() => db.close());
beforeEach(() => db.reset());
afterEach(async () => {
  await drainDeferred();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BROWSER = { 'X-Requested-With': 'gd-admin', Origin: 'http://site.test' };
const ip = (n: number) => ({ 'CF-Connecting-IP': `203.0.113.${n}` });

describe('operator injection', () => {
  it('login refuses operators in place of strings', async () => {
    for (const body of [
      { email: { $ne: null }, password: { $ne: null } },
      { email: { $gt: '' }, password: PASSWORD },
      { email: 'a@example.test', password: { $regex: '.*' } },
      { email: ['a@example.test'], password: PASSWORD },
    ]) {
      const res = await api.post('/api/v1/auth/login').send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('a user cannot be matched by an operator in the email', async () => {
    await actingAs(m, 'editor');
    const res = await api.post('/api/v1/auth/login').send({ email: { $ne: 'nobody@example.test' }, password: PASSWORD });
    expect(res.status).toBe(422);
    expect(res.body.access_token).toBeUndefined();
  });

  it('query strings cannot carry operators: bracket syntax is a literal key and changes nothing', async () => {
    // Express 5 parses queries with the simple parser, so page[$gt]=0 is a key named "page[$gt]", never an object.
    const { auth } = await actingAsSuperadmin(m);
    for (const [url, plain] of [
      ['/api/v1/public/posts?page[$gt]=0', '/api/v1/public/posts'],
      ['/api/v1/public/posts?category[$ne]=x', '/api/v1/public/posts'],
      ['/api/v1/users?page[$gt]=0', '/api/v1/users'],
      ['/api/v1/contact-messages?unread[$ne]=1', '/api/v1/contact-messages'],
    ] as const) {
      const [a, b] = [await api.get(url).set(auth), await api.get(plain).set(auth)];
      // Either refused (strict query schema) or ignored; never applied as an operator.
      expect([200, 422], url).toContain(a.status);
      if (a.status === 200) expect(a.body.data, url).toEqual(b.body.data);
    }
  });

  it('repeated parameters (arrays) are refused, not passed to the database', async () => {
    for (const url of ['/api/v1/public/posts?category=a&category=b', '/api/v1/public/posts?page=1&page=2']) {
      expect((await api.get(url)).status, url).toBe(422);
    }
  });

  it('operators and $where inside a public body are refused, never executed', async () => {
    const res = await api.post('/api/v1/contact').set(ip(1)).send({ name: { $ne: 1 }, email: 'a@example.test', message: { $where: 'sleep(5000)' }, captcha_id: { $ne: '' }, captcha_answer: 1 });
    expect(res.status).toBe(422);
    expect(await m.ContactMessage.countDocuments({})).toBe(0);
  });

  it('a __proto__ key is an unknown key, not prototype pollution', async () => {
    const { auth } = await actingAsSuperadmin(m);
    const res = await api.post('/api/v1/faqs').set(auth).set('Content-Type', 'application/json').send('{"question":"q","answer":"a","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    expect(res.status).toBe(422);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('mass assignment', () => {
  it('rejects fields a client must not set when creating or editing a user', async () => {
    const { auth, user } = await actingAsSuperadmin(m);
    const create = await api.post('/api/v1/users').set(auth).send({ name: 'X', email: 'x@example.test', password: PASSWORD, is_active: true, password_hash: 'x', role_ids: [1], _id: 99, password_changed_at: '2020-01-01' });
    expect(create.status).toBe(422);
    expect(Object.keys(create.body.error.details).sort()).toEqual(['_id', 'is_active', 'password_changed_at', 'password_hash', 'role_ids']);
    const edit = await api.patch(`/api/v1/users/${user._id}`).set(auth).send({ is_active: false, role_ids: [] });
    expect(edit.status).toBe(422);
    expect((await m.User.findById(user._id).lean())?.is_active).toBe(true);
  });

  it('rejects privilege fields on the own profile', async () => {
    const { auth, user } = await actingAs(m, 'editor', ['faqs.view']);
    const res = await api.patch('/api/v1/me').set(auth).send({ name: 'Me', email: 'new@example.test', role_ids: [1], is_active: false, permissions: ['users.delete'] });
    expect(res.status).toBe(422);
    const row = await m.User.findById(user._id).lean();
    expect(row?.email).toBe(user.email);
    expect(row?.role_ids).toEqual(user.role_ids);
  });

  it('rejects an _id or timestamps on content', async () => {
    const { auth } = await actingAsSuperadmin(m);
    const res = await api.post('/api/v1/faqs').set(auth).send({ question: 'q', answer: 'a', _id: 99, created_at: '2001-01-01' });
    expect(res.status).toBe(422);
    expect(await m.Faq.countDocuments({})).toBe(0);
  });
});

describe('request limits', () => {
  it('refuses a JSON body over 1 MB with 413', async () => {
    const res = await api.post('/api/v1/contact').set(ip(2)).send({ message: 'x'.repeat(1_200_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });
});

describe('access tokens after a password change', () => {
  it('stop working when issued before the change, and not when issued after', async () => {
    const { user, token } = await actingAs(m, 'editor');
    await api.get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    await m.User.updateOne({ _id: user._id }, { $set: { password_changed_at: new Date(Date.now() + 5000) } });
    await api.get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
    const later = await signAccessToken(testEnv(), user._id);
    await m.User.updateOne({ _id: user._id }, { $set: { password_changed_at: new Date(Date.now() - 60_000) } });
    await api.get('/api/v1/me').set('Authorization', `Bearer ${later.token}`).expect(200);
  });

  it('end to end: changing the password through /me ends the old session at once', async () => {
    const { user, token } = await actingAs(m, 'editor');
    // The token was issued a moment ago; make the password change land in a later second, as it does in real use.
    await new Promise((r) => setTimeout(r, 1100));
    await api.patch('/api/v1/me').set('Authorization', `Bearer ${token}`).send({ current_password: PASSWORD, password: 'another-long-password', password_confirmation: 'another-long-password' }).expect(200);
    await api.get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
    const login = await api.post('/api/v1/auth/login').set(ip(3)).send({ email: user.email, password: 'another-long-password' }).expect(200);
    await api.get('/api/v1/me').set('Authorization', `Bearer ${login.body.access_token}`).expect(200);
  });
});

describe('login timing', () => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  it('an unknown email and a wrong password take about as long', async () => {
    const users = [];
    for (let i = 0; i < 8; i++) users.push(await actingAs(m, 'editor'));
    // warm-up, so the memoised dummy hash and module loading are not measured
    await api.post('/api/v1/auth/login').set(ip(10)).send({ email: 'warm@example.test', password: 'whatever-long-password' });
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < 8; i++) {
      let t = performance.now();
      await api.post('/api/v1/auth/login').set(ip(20 + i)).send({ email: `nobody${i}@example.test`, password: 'whatever-long-password' }).expect(401);
      unknown.push(performance.now() - t);
      t = performance.now();
      await api.post('/api/v1/auth/login').set(ip(40 + i)).send({ email: users[i]!.user.email, password: 'whatever-long-password' }).expect(401);
      wrong.push(performance.now() - t);
    }
    const [u, w] = [median(unknown), median(wrong)];
    console.info(`login timing (median of 8, ms): unknown email ${u.toFixed(1)}, wrong password ${w.toFixed(1)}, ratio ${(u / w).toFixed(2)}`);
    expect(u / w).toBeGreaterThan(0.7);
    expect(u / w).toBeLessThan(1.4);
  });
});

describe('errors and logs', () => {
  it('a database failure answers a generic 500 and logs no credential', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' ')));
    const saved = process.env.VITEST;
    delete process.env.VITEST; // the error handler stays quiet under vitest; this test needs it to log
    try {
      const res = await client({ MONGODB_URI: 'mongodb://dbuser:sekrit-password@127.0.0.1:1/x' }).post('/api/v1/auth/login').set(ip(60)).send({ email: 'a@example.test', password: PASSWORD });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'server_error', message: 'Server error.' } });
      expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toMatch(/mongo|sekrit|127\.0\.0\.1|stack| at /i);
    } finally {
      process.env.VITEST = saved;
    }
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toMatch(/sekrit|dbuser/);
  }, 20000);

  it('the only console calls in the API are the two reviewed error loggers (and the CLI scripts)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk('src');
    const calls = files
      .filter((f) => !/[\\/](seed[\\/](?:run|indexes)|openapi[\\/]generate)\.ts$/.test(f))
      .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => /console\.\w+\(/.test(l)).map((l) => `${f.split(/[\\/]/).slice(-1)[0]}: ${l.trim()}`));
    expect(calls).toHaveLength(2);
    expect(calls.join('\n')).not.toMatch(/token|secret|password|pepper|uri|authorization|cookie/i);
  });
});

describe('cookies and CORS', () => {
  it('sets the refresh cookie host-only, HttpOnly, Secure, SameSite=Lax', async () => {
    const { user } = await actingAs(m, 'editor');
    const res = await api.post('/api/v1/auth/login').set(ip(70)).send({ email: user.email, password: PASSWORD }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('rt='))!;
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(JSON.stringify(res.body)).not.toContain(cookie.split(';')[0]!.slice(3));
  });

  it('a wildcard in CORS_ALLOWED_ORIGINS never produces an allow-origin header for another site', async () => {
    const res = await client({ CORS_ALLOWED_ORIGINS: '*' }).get('/api/v1/health').set('Origin', 'https://evil.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers a preflight from an unlisted origin without CORS headers', async () => {
    const res = await api.options('/api/v1/users').set('Origin', 'https://evil.test').set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refresh and logout reject a foreign Origin even with the custom header', async () => {
    for (const path of ['/api/v1/auth/refresh', '/api/v1/logout']) {
      const res = await api.post(path).set({ ...BROWSER, Origin: 'https://evil.test' }).set('Cookie', 'rt=x');
      expect(res.status, path).toBe(403);
    }
  });
});

describe('uploads', () => {
  const env = { GITHUB_REPO: 'owner/repo', GITHUB_REPO_TOKEN: 'tok-secret', MEDIA_BASE_PATH: '/media' };

  async function setup() {
    await seedAccess(m, {});
    const gh = fakeGithub();
    vi.stubGlobal('fetch', gh.fetch);
    const { auth } = await actingAs(m, 'editor', ['sections.view', 'sections.update']);
    const id = (await m.Section.findOne({ key: 'hero' }).lean())!._id;
    return { gh, auth, id };
  }
  const send = (auth: { Authorization: string }, id: number, files: { b: Buffer; name: string; type: string }[], size = [1200, 800]) => {
    const r = client(env).post(`/api/v1/sections/${id}/image`).set(auth);
    for (const f of files) r.attach('variants', f.b, { filename: f.name, contentType: f.type });
    return r.field('width', String(size[0])).field('height', String(size[1]));
  };

  it('refuses SVG, even named .webp and typed image/webp', async () => {
    const { gh, auth, id } = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
    await send(auth, id, [{ b: svg, name: 'a.webp', type: 'image/webp' }]).expect(422);
    await send(auth, id, [{ b: Buffer.concat([Buffer.from('<?xml version="1.0"?>'), svg]), name: 'a.svg', type: 'image/svg+xml' }]).expect(422);
    expect(gh.fetch).not.toHaveBeenCalled();
  });

  it('refuses polyglots whose first bytes are not a WebP container (PNG, GIF, PDF, HTML, ZIP with an image name)', async () => {
    const { gh, auth, id } = await setup();
    const html = Buffer.from('<html><script>alert(1)</script>');
    for (const b of [Buffer.concat([png(), html]), Buffer.concat([Buffer.from('GIF89a'), html]), Buffer.concat([Buffer.from('%PDF-1.4\n'), html]), Buffer.concat([Buffer.from('PK\x03\x04'), html]), html]) {
      await send(auth, id, [{ b, name: 'x.webp', type: 'image/webp' }]).expect(422);
    }
    expect(gh.fetch).not.toHaveBeenCalled();
  });

  it('refuses a WebP whose declared size is huge (decompression bomb) without calling GitHub', async () => {
    const { gh, auth, id } = await setup();
    await send(auth, id, [{ b: webp(16000, 16000), name: 'x.webp', type: 'image/webp' }], [16000, 16000]).expect(422);
    expect(gh.fetch).not.toHaveBeenCalled();
  });

  it('names files on the server: a client file name with ../ changes nothing, and GitHub only sees this repository', async () => {
    const { gh, auth, id } = await setup();
    await send(auth, id, [{ b: webp(480, 320), name: '../../../.github/workflows/deploy.yml', type: 'image/webp' }], [480, 320]).expect(200);
    const files = gh.files();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^media\/sections\/[a-f0-9]{32}\/480\.webp$/);
    expect(files.join()).not.toMatch(/\.\.|workflows/);
    for (const call of (gh.fetch as unknown as { mock: { calls: [string][] } }).mock.calls) {
      expect(String(call[0]).startsWith('https://api.github.com/repos/owner/repo/'), String(call[0])).toBe(true);
    }
  });

  it('a failed commit leaves the document without an image and returns no GitHub detail or token', async () => {
    const { gh, auth, id } = await setup();
    gh.state.failWith = 500;
    const res = await send(auth, id, [{ b: webp(480, 320), name: 'a.webp', type: 'image/webp' }], [480, 320]);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/tok-secret|boom/);
    expect((await m.Section.findById(id).lean())?.image).toBeNull();
  });
});

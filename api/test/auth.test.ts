import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '../src/auth/password.ts';
import { hashRefreshToken } from '../src/auth/tokens.ts';
import { actingAs, client, PASSWORD, refreshCookie, testEnv, useDb } from './helpers.ts';

const db = useDb();
const { m } = db;
const api = client();
beforeEach(() => db.reset());
afterAll(() => db.close());

const BROWSER = { 'X-Requested-With': 'gd-admin', Origin: 'http://site.test' };
const login = (email: string, password = PASSWORD) => api.post('/api/v1/auth/login').send({ email, password });
const refresh = (token: string | null, headers: Record<string, string> = BROWSER) =>
  api.post('/api/v1/auth/refresh').set(headers).set('Cookie', token ? `rt=${token}` : '');

describe('password hashes', () => {
  it('are self-describing, verifiable, salted and flagged for rehash when weak', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^\$pbkdf2-sha256\$i=100000\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(needsRehash(a)).toBe(false);
    expect(needsRehash(await hashPassword('x', 1000))).toBe(true);
  });
});

describe('POST /auth/login', () => {
  it('returns a bearer token and sets the refresh cookie (never in the body)', async () => {
    const u = await actingAs(m, 'viewer', ['users.view']);
    const res = await login(u.user.email);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    expect(Object.keys(res.body).sort()).toEqual(['access_token', 'expires_in', 'token_type']);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^rt=[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookie).not.toContain('Domain');
    expect((await api.get('/api/v1/me').set('Authorization', `Bearer ${res.body.access_token}`)).status).toBe(200);
    // only a keyed hash of the token is stored
    const row = await m.RefreshToken.findOne({ user_id: u.user._id }).lean();
    expect(row!.token_hash).toBe(hashRefreshToken(testEnv(), refreshCookie(res)!));
  });

  it('answers identically for an unknown email and a wrong password', async () => {
    const u = await actingAs(m, 'viewer');
    const wrong = await login(u.user.email, 'not-the-password');
    const unknown = await login('nobody@example.test', 'not-the-password');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('refuses inactive users with the same message', async () => {
    const u = await actingAs(m, 'viewer', [], { is_active: false });
    const res = await login(u.user.email);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('These credentials do not match our records.');
  });

  it('validates the body and rejects unknown keys', async () => {
    expect((await api.post('/api/v1/auth/login').send({})).status).toBe(422);
    expect((await api.post('/api/v1/auth/login').send({ email: 'a@b.test', password: 'x', remember: true })).status).toBe(422);
  });

  it('upgrades an outdated hash on a successful login', async () => {
    const u = await actingAs(m, 'viewer');
    await m.User.updateOne({ _id: u.user._id }, { $set: { password_hash: await hashPassword(PASSWORD, 1000) } });
    expect((await login(u.user.email)).status).toBe(200);
    expect(needsRehash((await m.User.findOne({ _id: u.user._id }).lean())!.password_hash)).toBe(false);
  });

  it('throttles repeated attempts (10 a minute per IP) with 429 and Retry-After', async () => {
    for (let i = 0; i < 10; i++) expect((await login(`a${i}@example.test`, 'wrong')).status).toBe(401);
    const res = await login('a11@example.test', 'wrong');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('too_many_requests');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('throttles per email even when the IP changes', async () => {
    const u = await actingAs(m, 'viewer');
    for (let i = 0; i < 10; i++) await api.post('/api/v1/auth/login').set('CF-Connecting-IP', `10.0.0.${i}`).send({ email: u.user.email, password: 'wrong' });
    const res = await api.post('/api/v1/auth/login').set('CF-Connecting-IP', '10.0.1.1').send({ email: u.user.email, password: PASSWORD });
    expect(res.status).toBe(429);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the token and issues a new access token', async () => {
    const u = await actingAs(m, 'viewer');
    const first = refreshCookie(await login(u.user.email))!;
    const res = await refresh(first);
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    const second = refreshCookie(res)!;
    expect(second).not.toBe(first);
    expect((await refresh(second)).status).toBe(200);
  });

  it('revokes the whole family when a used token is presented again', async () => {
    const u = await actingAs(m, 'viewer');
    const first = refreshCookie(await login(u.user.email))!;
    const second = refreshCookie(await refresh(first))!;
    const reuse = await refresh(first);
    expect(reuse.status).toBe(401);
    // the legitimate descendant is dead too
    expect((await refresh(second)).status).toBe(401);
    expect(await m.RefreshToken.countDocuments({ revoked_at: null })).toBe(0);
  });

  it('is 403 without the X-Requested-With header or with a wrong or missing Origin', async () => {
    const u = await actingAs(m, 'viewer');
    const token = refreshCookie(await login(u.user.email))!;
    expect((await refresh(token, { Origin: 'http://site.test' })).status).toBe(403);
    expect((await refresh(token, { 'X-Requested-With': 'gd-admin', Origin: 'http://evil.test' })).status).toBe(403);
    expect((await refresh(token, { 'X-Requested-With': 'gd-admin' })).status).toBe(403);
    // none of those burned the token
    expect((await refresh(token)).status).toBe(200);
  });

  it('accepts a local development origin from CORS_ALLOWED_ORIGINS', async () => {
    const dev = client({ CORS_ALLOWED_ORIGINS: 'http://localhost:28301' });
    const u = await actingAs(m, 'viewer');
    const token = refreshCookie(await login(u.user.email))!;
    const res = await dev.post('/api/v1/auth/refresh').set({ 'X-Requested-With': 'gd-admin', Origin: 'http://localhost:28301' }).set('Cookie', `rt=${token}`);
    expect(res.status).toBe(200);
  });

  it('is 401 without a cookie, with garbage, or after the user was deactivated', async () => {
    expect((await refresh(null)).status).toBe(401);
    expect((await refresh('garbage')).status).toBe(401);
    const u = await actingAs(m, 'viewer');
    const token = refreshCookie(await login(u.user.email))!;
    await m.User.updateOne({ _id: u.user._id }, { $set: { is_active: false } });
    expect((await refresh(token)).status).toBe(401);
  });

  it('is 401 for an expired token', async () => {
    const u = await actingAs(m, 'viewer');
    const token = refreshCookie(await login(u.user.email))!;
    await m.RefreshToken.updateMany({}, { $set: { expires_at: new Date(Date.now() - 1000) } });
    expect((await refresh(token)).status).toBe(401);
  });
});

describe('POST /logout', () => {
  it('revokes the family and clears the cookie', async () => {
    const u = await actingAs(m, 'viewer');
    const token = refreshCookie(await login(u.user.email))!;
    const res = await api.post('/api/v1/logout').set(BROWSER).set('Cookie', `rt=${token}`);
    expect(res.status).toBe(204);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^rt=; Max-Age=0;/);
    expect((await refresh(token)).status).toBe(401);
  });

  it('needs the browser headers and tolerates a missing cookie', async () => {
    expect((await api.post('/api/v1/logout')).status).toBe(403);
    expect((await api.post('/api/v1/logout').set(BROWSER)).status).toBe(204);
  });
});

describe('password changes', () => {
  it('revoke every refresh token of the user', async () => {
    const u = await actingAs(m, 'viewer');
    const a = await login(u.user.email);
    const token = refreshCookie(a)!;
    const pw = 'a-brand-new-password';
    const patch = await api.patch('/api/v1/me').set('Authorization', `Bearer ${a.body.access_token}`)
      .send({ current_password: PASSWORD, password: pw, password_confirmation: pw });
    expect(patch.status).toBe(200);
    expect((await refresh(token)).status).toBe(401);
    expect((await login(u.user.email, pw)).status).toBe(200);
  });

  it('by an admin also revoke the target user tokens', async () => {
    const admin = await actingAs(m, 'manager', ['users.update']);
    const u = await actingAs(m, 'viewer');
    const token = refreshCookie(await login(u.user.email))!;
    const res = await api.patch(`/api/v1/users/${u.user._id}`).set(admin.auth).send({ password: 'another-long-password' });
    expect(res.status).toBe(200);
    expect((await refresh(token)).status).toBe(401);
  });
});

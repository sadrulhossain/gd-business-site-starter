import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.ts';
import { checkCaptcha } from '../src/modules/contact/captcha.ts';
import { drainDeferred } from '../src/runtime.ts';
import { seedAccess } from '../src/seed/seed.ts';
import { actingAs, client, useDb } from './helpers.ts';

const db = useDb();
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => db.reset());
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  await seedAccess(db.m, {});
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await drainDeferred();
  vi.unstubAllGlobals();
});

const solved = async (e: Partial<Env> = {}) => {
  const { data } = (await client(e).get('/api/v1/public/captcha').expect(200)).body;
  const [a, b] = (data.question as string).split(' + ').map(Number);
  return { captcha_id: data.id as string, captcha_answer: a! + b! };
};
const form = async (e: Partial<Env> = {}) => ({ name: 'Jane', email: 'jane@example.com', message: 'Hello there', ...(await solved(e)) });

describe('captcha', () => {
  it('issues {id, question} and stores it with an expiry', async () => {
    const r = await client().get('/api/v1/public/captcha').expect(200);
    expect(r.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.data.question).toMatch(/^[1-9] \+ [1-9]$/);
    const row = await db.m.Captcha.findById(r.body.data.id).lean();
    expect(row!.expires_at.getTime() - Date.now()).toBeGreaterThan(590_000);
  });

  it('works once, even for a wrong answer', async () => {
    const c = await solved();
    expect(await checkCaptcha(db.m, c.captcha_id, c.captcha_answer + 1)).toBe(false);
    expect(await checkCaptcha(db.m, c.captcha_id, c.captcha_answer)).toBe(false); // already burnt
    const d = await solved();
    expect(await checkCaptcha(db.m, d.captcha_id, d.captcha_answer)).toBe(true);
    expect(await checkCaptcha(db.m, d.captcha_id, d.captcha_answer)).toBe(false);
  });

  it('refuses an expired captcha before the TTL monitor deletes it', async () => {
    const c = await solved();
    expect(await db.m.Captcha.countDocuments()).toBe(1); // still stored
    expect(await checkCaptcha(db.m, c.captcha_id, c.captcha_answer, new Date(Date.now() + 601_000))).toBe(false);
    const d = await solved({ CAPTCHA_TTL_SECONDS: '60' });
    expect((await db.m.Captcha.findById(d.captcha_id).lean())!.expires_at.getTime() - Date.now()).toBeLessThan(61_000);
  });

  it('has a TTL index on expires_at', async () => {
    const idx = await db.m.Captcha.collection.indexes();
    expect(idx.some((i) => i.key.expires_at === 1 && i.expireAfterSeconds === 0)).toBe(true);
  });

  it('is rate limited to 30 per minute per IP', async () => {
    for (let i = 0; i < 30; i++) await client().get('/api/v1/public/captcha').expect(200);
    await client().get('/api/v1/public/captcha').expect(429);
  });
});

describe('POST /contact', () => {
  it('stores a message and returns the legacy body', async () => {
    const r = await client().post('/api/v1/contact').send({ ...(await form()), phone: '123', subject: 'Hi' }).expect(201);
    expect(r.body).toEqual({ data: { received: true } });
    const rows = await db.m.ContactMessage.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Jane', phone: '123', subject: 'Hi', read_at: null });
  });

  it('rejects a wrong captcha answer and stores nothing', async () => {
    const f = await form();
    const r = await client().post('/api/v1/contact').send({ ...f, captcha_answer: f.captcha_answer + 1 }).expect(422);
    expect(Object.keys(r.body.error.details)).toEqual(['captcha_answer']);
    expect(await db.m.ContactMessage.countDocuments()).toBe(0);
  });

  it('accepts each captcha only once', async () => {
    const f = await form();
    await client().post('/api/v1/contact').send(f).expect(201);
    const r = await client().post('/api/v1/contact').send(f).expect(422);
    expect(typeof r.body.error.details.captcha_answer[0]).toBe('string');
    expect(await db.m.ContactMessage.countDocuments()).toBe(1);
  });

  it('consumes the captcha even when other fields are invalid', async () => {
    const c = await solved();
    await client().post('/api/v1/contact').send({ email: 'nope', ...c }).expect(422);
    await client().post('/api/v1/contact').send({ name: 'J', email: 'j@example.com', message: 'm', ...c }).expect(422);
    expect(await db.m.ContactMessage.countDocuments()).toBe(0);
  });

  it('validates input and requires the captcha fields', async () => {
    const r = await client().post('/api/v1/contact').send({}).expect(422);
    expect(Object.keys(r.body.error.details).sort()).toEqual(['captcha_answer', 'captcha_id', 'email', 'message', 'name']);
  });

  it('answers a filled honeypot like a success but stores and consumes nothing', async () => {
    const f = await form();
    const r = await client().post('/api/v1/contact').send({ ...f, website: 'http://spam.test' }).expect(201);
    expect(r.body).toEqual({ data: { received: true } });
    expect(await db.m.ContactMessage.countDocuments()).toBe(0);
    expect(await db.m.Captcha.countDocuments()).toBe(1);
    await drainDeferred();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throttles submissions per IP (5 per minute by default)', async () => {
    for (let i = 0; i < 5; i++) await client().post('/api/v1/contact').send({}).expect(422);
    await client().post('/api/v1/contact').send({}).expect(429);
    const e = { CONTACT_PER_MINUTE: '2' };
    await db.reset();
    await client(e).post('/api/v1/contact').set('cf-connecting-ip', '9.9.9.9').send({}).expect(422);
    await client(e).post('/api/v1/contact').set('cf-connecting-ip', '9.9.9.9').send({}).expect(422);
    await client(e).post('/api/v1/contact').set('cf-connecting-ip', '9.9.9.9').send({}).expect(429);
    await client(e).post('/api/v1/contact').set('cf-connecting-ip', '8.8.8.8').send({}).expect(422); // another IP
  });
});

describe('notifications (MAIL_PROVIDER)', () => {
  it('none (default): stores only, no outbound call', async () => {
    await client().post('/api/v1/contact').send(await form()).expect(201);
    await drainDeferred();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('webhook: POSTs the message to NOTIFY_WEBHOOK_URL', async () => {
    const e = { MAIL_PROVIDER: 'webhook', NOTIFY_WEBHOOK_URL: 'https://hooks.example/secret-path' };
    await client(e).post('/api/v1/contact').send({ ...(await form(e)), subject: 'Hi', phone: '123' }).expect(201);
    await drainDeferred();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://hooks.example/secret-path');
    const body = JSON.parse(init.body);
    expect(body.text).toContain('New contact message: Hi');
    expect(body.text).toContain('jane@example.com');
    expect(body.text).toContain('Hello there');
  });

  it('http: sends through the provider API to the settings email, falling back to CONTACT_NOTIFY_TO', async () => {
    const e = { MAIL_PROVIDER: 'http', MAIL_API_KEY: 'key-123', MAIL_FROM_ADDRESS: 'onboarding@provider.example', CONTACT_NOTIFY_TO: 'fallback@example.com' };
    await db.m.Setting.updateOne({ _id: 1 }, { $set: { email: 'owner@example.com' } }, { upsert: true });
    await client(e).post('/api/v1/contact').send({ ...(await form(e)), subject: 'Hi' }).expect(201);
    await drainDeferred();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer key-123');
    expect(JSON.parse(init.body)).toMatchObject({ from: 'onboarding@provider.example', to: ['owner@example.com'], subject: 'New contact message: Hi', reply_to: 'jane@example.com' });
    await db.m.Setting.updateOne({ _id: 1 }, { $set: { email: null } });
    await client(e).post('/api/v1/contact').send(await form(e)).expect(201);
    await drainDeferred();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).to).toEqual(['fallback@example.com']);
  });

  it('http: sends nothing when no recipient is known', async () => {
    const e = { MAIL_PROVIDER: 'http', MAIL_API_KEY: 'k', MAIL_FROM_ADDRESS: 'a@b.test' };
    await client(e).post('/api/v1/contact').send(await form(e)).expect(201);
    await drainDeferred();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['webhook', { MAIL_PROVIDER: 'webhook', NOTIFY_WEBHOOK_URL: 'https://hooks.example/x' }],
    ['http', { MAIL_PROVIDER: 'http', MAIL_API_KEY: 'k', MAIL_FROM_ADDRESS: 'a@b.test', CONTACT_NOTIFY_TO: 'o@example.com' }],
  ])('a failing %s notifier never fails the request', async (_n, e) => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 500 }));
    await client(e).post('/api/v1/contact').send(await form(e)).expect(201);
    await drainDeferred(); // swallowed by defer(): the error was logged, not thrown
    expect(await db.m.ContactMessage.countDocuments()).toBe(1);
    fetchMock.mockImplementation(async () => { throw new Error('network down'); });
    await client(e).post('/api/v1/contact').send(await form(e)).expect(201);
    await drainDeferred();
    expect(await db.m.ContactMessage.countDocuments()).toBe(2);
  });
});

describe('inbox', () => {
  const msg = (id: number, over: Record<string, unknown> = {}) => db.m.ContactMessage.create({ _id: id, name: 'J', email: 'j@example.com', message: 'm', ...over });

  it('requires authentication and contact.view', async () => {
    await msg(1);
    await client().get('/api/v1/contact-messages').expect(401);
    await client().post('/api/v1/contact-messages/1/read').expect(401);
    const u = await actingAs(db.m, 'nobody');
    await client().get('/api/v1/contact-messages').set(u.auth).expect(403);
    await client().get('/api/v1/contact-messages/1').set(u.auth).expect(403);
  });

  it('lists newest first, filters unread and shows one', async () => {
    await msg(1, { name: 'Read', read_at: new Date() });
    await msg(2, { name: 'Unread' });
    const u = await actingAs(db.m, 'viewer', ['contact.view']);
    const all = await client().get('/api/v1/contact-messages').set(u.auth).expect(200);
    expect(all.body.data.map((m: { name: string }) => m.name)).toEqual(['Unread', 'Read']);
    expect(all.body.meta.per_page).toBe(20);
    expect((await client().get('/api/v1/contact-messages?unread=1').set(u.auth).expect(200)).body.data).toHaveLength(1);
    expect((await client().get('/api/v1/contact-messages/2').set(u.auth).expect(200)).body.data.email).toBe('j@example.com');
    await client().get('/api/v1/contact-messages/99').set(u.auth).expect(404);
  });

  it('marks read once and needs contact.update', async () => {
    await msg(1);
    const v = await actingAs(db.m, 'viewer', ['contact.view']);
    await client().post('/api/v1/contact-messages/1/read').set(v.auth).expect(403);
    expect((await db.m.ContactMessage.findById(1).lean())!.read_at).toBeNull();
    const e = await actingAs(db.m, 'editor', ['contact.update']);
    await client().post('/api/v1/contact-messages/1/read').set(e.auth).expect(200);
    const first = (await db.m.ContactMessage.findById(1).lean())!.read_at!;
    await new Promise((r) => setTimeout(r, 20));
    await client().post('/api/v1/contact-messages/1/read').set(e.auth).expect(200);
    expect((await db.m.ContactMessage.findById(1).lean())!.read_at!.getTime()).toBe(first.getTime());
    await client().post('/api/v1/contact-messages/99/read').set(e.auth).expect(404);
  });

  it('has no create or delete for admins', async () => {
    await msg(1);
    const u = await actingAs(db.m, 'editor', ['contact.view', 'contact.update']);
    await client().post('/api/v1/contact-messages').set(u.auth).send({}).expect(405);
    await client().delete('/api/v1/contact-messages/1').set(u.auth).expect(405);
  });
});

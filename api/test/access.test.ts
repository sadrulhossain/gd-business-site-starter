import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SUPERADMIN_ROLE, roleGrants } from '../src/access/modules.ts';
import { verifyPassword } from '../src/auth/password.ts';
import { signAccessToken } from '../src/auth/tokens.ts';
import { inList } from '../src/db.ts';
import { nextId } from '../src/models.ts';
import { seedAccess } from '../src/seed/seed.ts';
import { actingAs, actingAsSuperadmin, client, testEnv, useDb } from './helpers.ts';

const db = useDb();
const { m } = db;
const api = client();
beforeAll(() => db.reset());
beforeEach(() => db.reset());
afterAll(() => db.close());

describe('authentication and permission gates', () => {
  it('rejects unauthenticated requests with a json 401', async () => {
    for (const path of ['/api/v1/me', '/api/v1/me/menus', '/api/v1/users', '/api/v1/roles', '/api/v1/permissions', '/api/v1/menus']) {
      const res = await api.get(path);
      expect(res.status, path).toBe(401);
      expect(res.body).toEqual({ error: { code: 'unauthenticated', message: 'Unauthenticated.' } });
    }
  });

  it('rejects an invalid, tampered or expired token with 401', async () => {
    const { token } = await signAccessToken(testEnv({ ACCESS_TOKEN_TTL_SECONDS: '1' }), 1);
    expect((await api.get('/api/v1/me').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await api.get('/api/v1/me').set('Authorization', `Bearer ${token}x`)).status).toBe(401);
    await new Promise((r) => setTimeout(r, 2100));
    expect((await api.get('/api/v1/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('returns 403 json when the permission is missing, 401 before 403', async () => {
    const u = await actingAs(m, 'editor', ['menus.view']);
    const res = await api.get('/api/v1/users').set(u.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('lets a role holding the permission through, and the superadmin without it', async () => {
    const a = await actingAs(m, 'auditor', ['users.view']);
    expect((await api.get('/api/v1/users').set(a.auth)).status).toBe(200);
    const root = await actingAsSuperadmin(m);
    expect((await api.get('/api/v1/users').set(root.auth)).status).toBe(200);
  });

  it('refuses a token of an inactive user', async () => {
    const u = await actingAs(m, 'viewer', ['users.view'], { is_active: false });
    expect((await api.get('/api/v1/me').set(u.auth)).status).toBe(401);
  });
});

describe('GET /me', () => {
  it('returns the user with roles and sorted permissions', async () => {
    const u = await actingAs(m, 'editor', ['menus.view', 'dashboard.view']);
    const res = await api.get('/api/v1/me').set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { id: u.user._id, name: u.user.name, email: u.user.email, is_superadmin: false, roles: ['editor'], permissions: ['dashboard.view', 'menus.view'] },
    });
  });

  it('gives the superadmin every permission name', async () => {
    const root = await actingAsSuperadmin(m);
    const res = await api.get('/api/v1/me').set(root.auth);
    expect(res.body.data.is_superadmin).toBe(true);
    expect(res.body.data.permissions).toContain('users.delete');
    expect(res.body.data.permissions).toEqual([...res.body.data.permissions].sort());
  });
});

describe('PATCH /me', () => {
  it('requires authentication', async () => {
    expect((await api.patch('/api/v1/me').send({ name: 'x' })).status).toBe(401);
  });

  it('renames the user and answers like GET /me', async () => {
    const u = await actingAs(m, 'nobody');
    const res = await api.patch('/api/v1/me').set(u.auth).send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'New Name', email: u.user.email });
  });

  it('rejects an empty name and unknown fields', async () => {
    const u = await actingAs(m, 'nobody');
    const bad = await api.patch('/api/v1/me').set(u.auth).send({ name: '' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toHaveProperty('name');
    const extra = await api.patch('/api/v1/me').set(u.auth).send({ name: 'x', role_ids: [1] });
    expect(extra.status).toBe(422);
    expect(extra.body.error.details).toHaveProperty('role_ids');
  });

  it('changes the password only with the current one, confirmed and long enough', async () => {
    const u = await actingAs(m, 'nobody');
    const patch = (body: object) => api.patch('/api/v1/me').set(u.auth).send(body);
    const key = (r: { body: { error: { details: object } } }) => Object.keys(r.body.error.details);
    const pw = 'a-brand-new-password';
    expect(key(await patch({ password: pw }))).toContain('current_password');
    expect(key(await patch({ current_password: 'wrong', password: pw, password_confirmation: pw }))).toContain('current_password');
    expect(key(await patch({ current_password: 'a-long-test-password', password: 'short', password_confirmation: 'short' }))).toContain('password');
    expect(key(await patch({ current_password: 'a-long-test-password', password: pw, password_confirmation: 'different-one-here' }))).toContain('password');
    expect((await patch({ current_password: 'a-long-test-password', password: pw, password_confirmation: pw })).status).toBe(200);
    const row = await m.User.findOne({ _id: u.user._id }).lean();
    expect(await verifyPassword(pw, row!.password_hash)).toBe(true);
  });
});

describe('GET /me/menus', () => {
  beforeEach(async () => {
    const mk = async (o: { title: string; sort: number; permission?: string; parent?: number }) =>
      (await m.Menu.create({ _id: await nextId(m, 'menus'), title: o.title, sort: o.sort, permission_name: o.permission ?? null, parent_id: o.parent ?? null })).toObject()._id;
    await mk({ title: 'Dashboard', sort: 0, permission: 'dashboard.view' });
    const content = await mk({ title: 'Content', sort: 10 });
    await mk({ title: 'Posts', sort: 1, permission: 'posts.view', parent: content });
    await mk({ title: 'Pages', sort: 2, permission: 'pages.view', parent: content });
    const settings = await mk({ title: 'Settings', sort: 20 });
    await mk({ title: 'General', sort: 1, permission: 'settings.view', parent: settings });
  });
  const titles = (items: { title: string; children: never[] }[]): string[] => items.flatMap((i) => [i.title, ...titles(i.children)]);

  it('shows a restricted role only its menus', async () => {
    const u = await actingAs(m, 'editor', ['dashboard.view', 'posts.view']);
    expect(titles((await api.get('/api/v1/me/menus').set(u.auth)).body.data)).toEqual(['Dashboard', 'Content', 'Posts']);
  });

  it('hides groups that have no visible children', async () => {
    const u = await actingAs(m, 'viewer', ['dashboard.view']);
    expect(titles((await api.get('/api/v1/me/menus').set(u.auth)).body.data)).toEqual(['Dashboard']);
  });

  it('returns an empty list for a role without menu permissions', async () => {
    const u = await actingAs(m, 'nobody');
    expect((await api.get('/api/v1/me/menus').set(u.auth)).body).toEqual({ data: [] });
  });

  it('shows the superadmin every menu', async () => {
    const root = await actingAsSuperadmin(m);
    expect(titles((await api.get('/api/v1/me/menus').set(root.auth)).body.data)).toEqual(['Dashboard', 'Content', 'Posts', 'Pages', 'Settings', 'General']);
  });
});

describe('menu admin', () => {
  beforeEach(() => seedAccess(m));

  it('requires authentication and permissions', async () => {
    expect((await api.get('/api/v1/menus')).status).toBe(401);
    expect((await api.put('/api/v1/menus/reorder').send({ ids: [1] })).status).toBe(401);
    const u = await actingAs(m, 'nobody');
    expect((await api.get('/api/v1/menus').set(u.auth)).status).toBe(403);
    expect((await api.put('/api/v1/menus/reorder').set(u.auth).send({ ids: [1] })).status).toBe(403);
  });

  it('lists the whole tree depth-first with depth', async () => {
    const u = await actingAs(m, 'viewer', ['menus.view']);
    const rows = (await api.get('/api/v1/menus').set(u.auth)).body.data as { id: number; title: string; depth: number; parent_id: number | null }[];
    const group = rows.find((r) => r.title === 'Access')!;
    const child = rows.find((r) => r.title === 'Users')!;
    expect(group.depth).toBe(0);
    expect(child).toMatchObject({ depth: 1, parent_id: group.id });
    expect(rows.indexOf(child)).toBe(rows.indexOf(group) + 1);
  });

  it('edits title and icon only', async () => {
    const u = await actingAs(m, 'editor', ['menus.update']);
    const menu = (await m.Menu.findOne({ path: '/users' }).lean())!;
    const ok = await api.patch(`/api/v1/menus/${menu._id}`).set(u.auth).send({ title: 'People', icon: 'box' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.title).toBe('People');
    // unknown keys are rejected (zod strict), so the path cannot change
    expect((await api.patch(`/api/v1/menus/${menu._id}`).set(u.auth).send({ title: 'x', path: '/hacked' })).status).toBe(422);
    expect((await m.Menu.findOne({ _id: menu._id }).lean())!.path).toBe('/users');
    const empty = await api.patch(`/api/v1/menus/${menu._id}`).set(u.auth).send({ title: '' });
    expect(empty.status).toBe(422);
    expect(empty.body.error.details).toHaveProperty('title');
    expect((await api.patch('/api/v1/menus/99999').set(u.auth).send({ title: 'x' })).status).toBe(404);
  });

  it('reorders siblings and rejects mixed parents and unknown ids', async () => {
    const u = await actingAs(m, 'editor', ['menus.update']);
    const top = (await m.Menu.find({ parent_id: null }).sort({ sort: 1 }).lean()).map((x) => x._id);
    const child = (await m.Menu.findOne({ path: '/users' }).lean())!._id;
    expect((await api.put('/api/v1/menus/reorder').set(u.auth).send({ ids: [...top].reverse() })).status).toBe(200);
    expect((await m.Menu.find({ parent_id: null }).sort({ sort: 1 }).lean()).map((x) => x._id)).toEqual([...top].reverse());
    const mixed = await api.put('/api/v1/menus/reorder').set(u.auth).send({ ids: [top[0], child] });
    expect(mixed.status).toBe(422);
    expect(mixed.body.error.details).toHaveProperty('ids');
    const unknown = await api.put('/api/v1/menus/reorder').set(u.auth).send({ ids: [999999] });
    expect(unknown.body.error.details).toHaveProperty(['ids.0']);
  });
});

describe('roles', () => {
  it('requires authentication and roles.view', async () => {
    const u = await actingAs(m, 'nobody');
    expect((await api.get('/api/v1/roles').set(u.auth)).status).toBe(403);
    expect((await api.get('/api/v1/permissions').set(u.auth)).status).toBe(403);
  });

  it('lists roles without the superadmin and lists permission names', async () => {
    const u = await actingAs(m, 'viewer', ['roles.view']);
    await actingAsSuperadmin(m);
    const names = ((await api.get('/api/v1/roles').set(u.auth)).body.data as { name: string }[]).map((r) => r.name);
    expect(names).toContain('viewer');
    expect(names).not.toContain(SUPERADMIN_ROLE);
    const perms = (await api.get('/api/v1/permissions').set(u.auth)).body.data as string[];
    expect(perms).toContain('roles.view');
    expect(perms).toEqual([...perms].sort());
  });

  it('creates a role with permissions', async () => {
    const u = await actingAs(m, 'manager', ['roles.create', 'menus.view', 'menus.update']);
    const res = await api.post('/api/v1/roles').set(u.auth).send({ name: 'editor', permissions: ['menus.view'] });
    expect(res.status).toBe(201);
    expect(res.body.data.permissions).toEqual(['menus.view']);
  });

  it('rejects a duplicate, the superadmin name and a bad name', async () => {
    const u = await actingAs(m, 'manager', ['roles.create']);
    for (const name of ['manager', 'superadmin', 'Bad Name']) {
      const res = await api.post('/api/v1/roles').set(u.auth).send({ name });
      expect(res.status, name).toBe(422);
      expect(res.body.error.details).toHaveProperty('name');
    }
  });

  it('only lets a non-superadmin grant permissions they hold', async () => {
    const u = await actingAs(m, 'manager', ['roles.create', 'roles.update', 'menus.view']);
    const role = (await m.Role.create({ _id: await nextId(m, 'roles'), name: 'editor', permissions: [] })).toObject();
    const bad = await api.post('/api/v1/roles').set(u.auth).send({ name: 'x', permissions: ['users.delete'] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toHaveProperty(['permissions.0']);
    expect((await api.patch(`/api/v1/roles/${role._id}`).set(u.auth).send({ permissions: ['menus.view'] })).status).toBe(200);
    const root = await actingAsSuperadmin(m);
    expect((await api.patch(`/api/v1/roles/${role._id}`).set(root.auth).send({ permissions: ['users.delete'] })).status).toBe(200);
    expect((await api.patch(`/api/v1/roles/${role._id}`).set(root.auth).send({ permissions: ['made.up'] })).status).toBe(422);
  });

  it('syncs permissions on update', async () => {
    const u = await actingAs(m, 'manager', ['roles.update', 'menus.view', 'menus.update']);
    const role = (await m.Role.create({ _id: await nextId(m, 'roles'), name: 'editor', permissions: ['menus.view'] })).toObject();
    await api.patch(`/api/v1/roles/${role._id}`).set(u.auth).send({ permissions: ['menus.update'] });
    expect((await m.Role.findOne({ _id: role._id }).lean())!.permissions).toEqual(['menus.update']);
  });

  it('never changes or deletes the superadmin role', async () => {
    const u = await actingAs(m, 'manager', ['roles.update', 'roles.delete']);
    const root = (await actingAsSuperadmin(m)).role;
    expect((await api.patch(`/api/v1/roles/${root._id}`).set(u.auth).send({ name: 'x' })).status).toBe(403);
    expect((await api.delete(`/api/v1/roles/${root._id}`).set(u.auth)).status).toBe(403);
    const sa = await actingAsSuperadmin(m);
    expect((await api.delete(`/api/v1/roles/${root._id}`).set(sa.auth)).status).toBe(403);
  });

  it('deletes a role and detaches it from users', async () => {
    const u = await actingAs(m, 'manager', ['roles.delete']);
    const holder = await actingAs(m, 'temp');
    expect((await api.delete(`/api/v1/roles/${holder.role._id}`).set(u.auth)).status).toBe(204);
    expect(await m.Role.exists({ name: 'temp' })).toBeNull();
    expect((await m.User.findOne({ _id: holder.user._id }).lean())!.role_ids).toEqual([]);
  });
});

describe('users', () => {
  it('requires authentication and users.view', async () => {
    const u = await actingAs(m, 'nobody');
    expect((await api.get('/api/v1/users').set(u.auth)).status).toBe(403);
  });

  it('lists users paginated with their roles', async () => {
    const me = await actingAs(m, 'viewer', ['users.view']);
    const res = await api.get('/api/v1/users').set(me.auth);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ current_page: 1, per_page: 15, total: 1 });
    expect(res.body.data[0]).toMatchObject({ id: me.user._id, roles: ['viewer'] });
    expect((await api.get('/api/v1/users?page=abc').set(me.auth)).status).toBe(422);
    expect((await api.get('/api/v1/users?filter[email]=x').set(me.auth)).status).toBe(422);
  });

  it('creates a user with roles and hashes the password', async () => {
    const u = await actingAs(m, 'manager', ['users.create']);
    await m.Role.create({ _id: await nextId(m, 'roles'), name: 'editor', permissions: [] });
    const res = await api.post('/api/v1/users').set(u.auth).send({ name: 'Ann', email: 'Ann@Example.com', password: 'a-long-password-1', roles: ['editor'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: 'ann@example.com', roles: ['editor'] });
    const row = await m.User.findOne({ email: 'ann@example.com' }).lean();
    expect(row!.password_hash).not.toContain('a-long-password-1');
    expect(row!.password_hash.startsWith('$pbkdf2-sha256$i=')).toBe(true);
  });

  it('rejects bad input with field keys, duplicates and the superadmin role', async () => {
    const u = await actingAs(m, 'manager', ['users.create']);
    await actingAsSuperadmin(m);
    const bad = await api.post('/api/v1/users').set(u.auth).send({ name: '', email: 'nope', password: 'short', roles: ['superadmin'] });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.details)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    const role = await api.post('/api/v1/users').set(u.auth).send({ name: 'A', email: 'a@example.com', password: 'a-long-password-1', roles: ['superadmin'] });
    expect(role.body.error.details).toHaveProperty(['roles.0']);
    const dup = await api.post('/api/v1/users').set(u.auth).send({ name: 'A', email: u.user.email, password: 'a-long-password-1' });
    expect(dup.body.error.details).toHaveProperty('email');
  });

  it('keeps the password when it is blank on update', async () => {
    const u = await actingAs(m, 'manager', ['users.update']);
    const target = await actingAs(m, 'other');
    const res = await api.patch(`/api/v1/users/${target.user._id}`).set(u.auth).send({ name: 'Renamed', password: null });
    expect(res.status).toBe(200);
    const row = await m.User.findOne({ _id: target.user._id }).lean();
    expect(row!.name).toBe('Renamed');
    expect(row!.password_hash).toBe(target.user.password_hash);
  });

  it('keeps the superadmin role when a superadmin edits roles', async () => {
    const actor = await actingAs(m, 'manager', ['users.update']);
    const root = await actingAsSuperadmin(m);
    const res = await api.patch(`/api/v1/users/${root.user._id}`).set(root.auth).send({ roles: [] });
    expect(res.status).toBe(200);
    expect((await m.User.findOne({ _id: root.user._id }).lean())!.role_ids).toEqual([root.role._id]);
    expect(actor.user._id).not.toBe(root.user._id);
  });

  it('forbids a non-superadmin from changing or deleting a superadmin', async () => {
    const u = await actingAs(m, 'manager', ['users.update', 'users.delete']);
    const root = await actingAsSuperadmin(m);
    expect((await api.patch(`/api/v1/users/${root.user._id}`).set(u.auth).send({ name: 'x' })).status).toBe(403);
    expect((await api.delete(`/api/v1/users/${root.user._id}`).set(u.auth)).status).toBe(403);
  });

  it('deletes a user but never yourself', async () => {
    const me = await actingAs(m, 'manager', ['users.delete']);
    const other = await actingAs(m, 'other');
    expect((await api.delete(`/api/v1/users/${me.user._id}`).set(me.auth)).status).toBe(403);
    expect((await api.delete(`/api/v1/users/${other.user._id}`).set(me.auth)).status).toBe(204);
    expect(await m.User.exists({ _id: other.user._id })).toBeNull();
  });

  it('answers 404 for unknown or malformed ids', async () => {
    const u = await actingAs(m, 'viewer', ['users.view']);
    expect((await api.get('/api/v1/users/99999').set(u.auth)).status).toBe(404);
    expect((await api.get('/api/v1/users/abc').set(u.auth)).status).toBe(404);
  });
});

describe('seeding', () => {
  it('seeds roles, menus and the superadmin idempotently', async () => {
    const opts = { superadmin: { email: 'Root@Example.test', password: 'a-long-test-password' } };
    expect((await seedAccess(m, opts)).superadmin).toBe('created');
    expect((await seedAccess(m, opts)).superadmin).toBe('exists');
    expect((await m.Role.find({}).lean()).map((r) => r.name).sort()).toEqual(['admin', 'superadmin']);
    expect((await m.Role.findOne({ name: 'admin' }).lean())!.permissions).toEqual(roleGrants.admin);
    expect(await m.Menu.countDocuments({ path: inList(['/users', '/roles', '/menus', '/']) })).toBe(4);
    expect(await m.Menu.countDocuments({ title: 'Access' })).toBe(1);
    const root = (await m.User.findOne({ email: 'root@example.test' }).lean())!;
    expect(await verifyPassword('a-long-test-password', root.password_hash)).toBe(true);
    expect(await m.User.countDocuments()).toBe(1);
  });

  it('never overwrites edits and skips the superadmin without env', async () => {
    await seedAccess(m);
    await m.Role.updateOne({ name: 'admin' }, { $set: { permissions: ['users.view'] } });
    await m.Menu.updateOne({ path: '/users' }, { $set: { title: 'People' } });
    expect((await seedAccess(m)).superadmin).toBe('skipped');
    expect((await m.Role.findOne({ name: 'admin' }).lean())!.permissions).toEqual(['users.view']);
    expect((await m.Menu.findOne({ path: '/users' }).lean())!.title).toBe('People');
    expect(await m.User.countDocuments()).toBe(0);
  });
});

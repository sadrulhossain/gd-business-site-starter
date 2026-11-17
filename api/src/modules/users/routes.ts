import { SUPERADMIN_ROLE } from '../../access/modules.ts';
import { hashPassword } from '../../auth/password.ts';
import { inList } from '../../db.ts';
import { forbidden, notFoundError } from '../../errors.ts';
import { idParam, iso, paginate } from '../../http/helpers.ts';
import type { Api } from '../../http/route.ts';
import { parse, validationError } from '../../http/validate.ts';
import { nextId, type Models, type UserDoc } from '../../models.ts';
import { listQuerySchema, storeUserSchema, updateUserSchema } from './schema.ts';

async function rolesFor(m: Models, users: UserDoc[]) {
  const ids = [...new Set(users.flatMap((u) => u.role_ids))];
  const roles = ids.length ? await m.Role.find({ _id: inList(ids) }).lean() : [];
  return new Map(roles.map((r) => [r._id, r.name]));
}

/** The superadmin role is left out of the editable list; is_superadmin reports it instead. */
async function toResources(m: Models, users: UserDoc[]) {
  const names = await rolesFor(m, users);
  return users.map((u) => {
    const roleNames = u.role_ids.map((id) => names.get(id)).filter((n): n is string => !!n);
    return {
      id: u._id,
      name: u.name,
      email: u.email,
      roles: roleNames.filter((n) => n !== SUPERADMIN_ROLE),
      is_superadmin: roleNames.includes(SUPERADMIN_ROLE),
      created_at: iso(u.created_at),
    };
  });
}

/** Role names -> ids; the superadmin role is never assignable and unknown names are a 422. */
async function resolveRoles(m: Models, names: string[]): Promise<number[]> {
  const unique = [...new Set(names)];
  const found = unique.length ? await m.Role.find({ name: inList(unique) }).lean() : [];
  const byName = new Map(found.map((r) => [r.name, r._id]));
  const details: Record<string, string[]> = {};
  names.forEach((n, i) => {
    if (n === SUPERADMIN_ROLE || !byName.has(n)) details[`roles.${i}`] = ['The selected role is invalid.'];
  });
  if (Object.keys(details).length) throw validationError(details);
  return unique.map((n) => byName.get(n)!);
}

const isSuper = async (m: Models, u: UserDoc) => (await toResources(m, [u]))[0]!.is_superadmin;

export function userRoutes(api: Api): void {
  api.get('/users', { permission: 'users.view' }, async (req, res) => {
    const { page } = parse(listQuerySchema, req.query);
    const m = res.locals.models();
    res.json(await paginate(m.User, `${req.baseUrl}${req.path}`, page, 15, (rows) => toResources(m, rows)));
  });

  api.get('/users/:id', { permission: 'users.view' }, async (req, res) => {
    const m = res.locals.models();
    const user = await m.User.findOne({ _id: idParam(req) }).lean();
    if (!user) throw notFoundError();
    res.json({ data: (await toResources(m, [user]))[0] });
  });

  api.post('/users', { permission: 'users.create' }, async (req, res) => {
    const body = parse(storeUserSchema, req.body);
    const m = res.locals.models();
    if (await m.User.exists({ email: body.email })) throw validationError({ email: ['The email has already been taken.'] });
    const role_ids = await resolveRoles(m, body.roles ?? []);
    const doc = await m.User.create({
      _id: await nextId(m, 'users'),
      name: body.name,
      email: body.email,
      password_hash: await hashPassword(body.password),
      role_ids,
    });
    res.status(201).json({ data: (await toResources(m, [doc.toObject()]))[0] });
  });

  const updateUser: Parameters<Api['patch']>[2] = async (req, res) => {
    const m = res.locals.models();
    const auth = res.locals.auth!;
    const target = await m.User.findOne({ _id: idParam(req) }).lean();
    if (!target) throw notFoundError();
    const targetIsSuper = await isSuper(m, target);
    // Policy: only a superadmin may touch a superadmin.
    if (targetIsSuper && !auth.isSuperadmin) throw forbidden();

    const body = parse(updateUserSchema, req.body);
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.email !== undefined && body.email !== target.email) {
      if (await m.User.exists({ email: body.email })) throw validationError({ email: ['The email has already been taken.'] });
      set.email = body.email;
    }
    if (body.password) {
      set.password_hash = await hashPassword(body.password);
      set.password_changed_at = new Date();
    }
    if (body.roles !== undefined) {
      const ids = await resolveRoles(m, body.roles);
      if (targetIsSuper) {
        const root = await m.Role.findOne({ name: SUPERADMIN_ROLE }).lean();
        if (root) ids.push(root._id);
      }
      set.role_ids = ids;
    }
    const updated = await m.User.findOneAndUpdate({ _id: target._id }, { $set: set }, { returnDocument: 'after' }).lean();
    if (set.password_hash) await m.RefreshToken.updateMany({ user_id: target._id, revoked_at: null }, { $set: { revoked_at: new Date() } });
    res.json({ data: (await toResources(m, [updated!]))[0] });
  };
  api.patch('/users/:id', { permission: 'users.update' }, updateUser);
  api.put('/users/:id', { permission: 'users.update' }, updateUser); // legacy apiResource accepts PUT and PATCH

  api.delete('/users/:id', { permission: 'users.delete' }, async (req, res) => {
    const m = res.locals.models();
    const auth = res.locals.auth!;
    const target = await m.User.findOne({ _id: idParam(req) }).lean();
    if (!target) throw notFoundError();
    if (target._id === auth.user.id) throw forbidden();
    if ((await isSuper(m, target)) && !auth.isSuperadmin) throw forbidden();
    await m.RefreshToken.deleteMany({ user_id: target._id });
    await m.User.deleteOne({ _id: target._id });
    res.status(204).end();
  });
}

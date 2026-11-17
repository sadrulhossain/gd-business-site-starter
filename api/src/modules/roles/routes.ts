import { permissionNames, SUPERADMIN_ROLE } from '../../access/modules.ts';
import { notEq } from '../../db.ts';
import { forbidden, notFoundError } from '../../errors.ts';
import { idParam } from '../../http/helpers.ts';
import type { Api } from '../../http/route.ts';
import { parse, validationError, z } from '../../http/validate.ts';
import type { Auth } from '../../middleware/auth.ts';
import { nextId, type Models, type RoleDoc } from '../../models.ts';

const nameField = z.string().max(60).regex(/^[a-z0-9_-]+$/, 'The name may only contain lowercase letters, numbers, dashes and underscores.');
const permissions = z.array(z.string().max(120));
export const storeRoleSchema = z.strictObject({ name: nameField, permissions: permissions.optional() });
export const updateRoleSchema = z.strictObject({ name: nameField.optional(), permissions: permissions.optional() });

const toResource = (r: RoleDoc) => ({ id: r._id, name: r.name, permissions: [...r.permissions].sort() });

/** A non-superadmin can grant only permissions they hold; the superadmin can grant the whole registry. */
function assertGrantable(auth: Auth, wanted: string[] | undefined): string[] {
  const allowed = auth.isSuperadmin ? new Set(permissionNames()) : auth.permissions;
  const details: Record<string, string[]> = {};
  (wanted ?? []).forEach((p, i) => {
    if (!allowed.has(p)) details[`permissions.${i}`] = ['The selected permission is invalid.'];
  });
  if (Object.keys(details).length) throw validationError(details);
  return [...new Set(wanted ?? [])];
}

async function assertNameFree(m: Models, name: string, ignoreId?: number): Promise<void> {
  if (name === SUPERADMIN_ROLE) throw validationError({ name: ['The selected name is invalid.'] });
  const existing = await m.Role.findOne({ name }).lean();
  if (existing && existing._id !== ignoreId) throw validationError({ name: ['The name has already been taken.'] });
}

export function roleRoutes(api: Api): void {
  api.get('/roles', { permission: 'roles.view' }, async (_req, res) => {
    const roles = await res.locals.models().Role.find({ name: notEq(SUPERADMIN_ROLE) }).sort({ name: 1 }).lean();
    res.json({ data: roles.map(toResource) });
  });

  api.get('/roles/:id', { permission: 'roles.view' }, async (req, res) => {
    const role = await res.locals.models().Role.findOne({ _id: idParam(req) }).lean();
    if (!role) throw notFoundError();
    res.json({ data: toResource(role) });
  });

  api.post('/roles', { permission: 'roles.create' }, async (req, res) => {
    const body = parse(storeRoleSchema, req.body);
    const m = res.locals.models();
    await assertNameFree(m, body.name);
    const grant = assertGrantable(res.locals.auth!, body.permissions);
    const role = await m.Role.create({ _id: await nextId(m, 'roles'), name: body.name, permissions: grant });
    res.status(201).json({ data: toResource(role.toObject()) });
  });

  const updateRole: Parameters<Api['patch']>[2] = async (req, res) => {
    const m = res.locals.models();
    const role = await m.Role.findOne({ _id: idParam(req) }).lean();
    if (!role) throw notFoundError();
    if (role.name === SUPERADMIN_ROLE) throw forbidden(); // never editable through the API
    const body = parse(updateRoleSchema, req.body);
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) {
      await assertNameFree(m, body.name, role._id);
      set.name = body.name;
    }
    if (body.permissions !== undefined) set.permissions = assertGrantable(res.locals.auth!, body.permissions);
    const updated = await m.Role.findOneAndUpdate({ _id: role._id }, { $set: set }, { returnDocument: 'after' }).lean();
    res.json({ data: toResource(updated!) });
  };
  api.patch('/roles/:id', { permission: 'roles.update' }, updateRole);
  api.put('/roles/:id', { permission: 'roles.update' }, updateRole); // legacy apiResource accepts PUT and PATCH

  api.delete('/roles/:id', { permission: 'roles.delete' }, async (req, res) => {
    const m = res.locals.models();
    const role = await m.Role.findOne({ _id: idParam(req) }).lean();
    if (!role) throw notFoundError();
    if (role.name === SUPERADMIN_ROLE) throw forbidden();
    await m.User.updateMany({ role_ids: role._id }, { $pull: { role_ids: role._id } });
    await m.Role.deleteOne({ _id: role._id });
    res.status(204).end();
  });

  api.get('/permissions', { permission: 'roles.view' }, (_req, res) => {
    res.json({ data: permissionNames() });
  });
}

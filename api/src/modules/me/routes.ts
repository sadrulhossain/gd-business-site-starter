import { hashPassword, MAX_LENGTH, MIN_LENGTH, verifyPassword } from '../../auth/password.ts';
import type { Api } from '../../http/route.ts';
import { parse, validationError, z } from '../../http/validate.ts';
import type { Auth } from '../../middleware/auth.ts';
import { menuTree } from '../menus/tree.ts';

export const meResource = (a: Auth) => ({
  id: a.user.id,
  name: a.user.name,
  email: a.user.email,
  is_superadmin: a.isSuperadmin,
  roles: a.roleNames,
  permissions: [...a.permissions].sort(),
});

const updateProfileSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  current_password: z.string().max(MAX_LENGTH).optional(),
  password: z.string().min(MIN_LENGTH, `The password must be at least ${MIN_LENGTH} characters.`).max(MAX_LENGTH).optional(),
  password_confirmation: z.string().max(MAX_LENGTH).optional(),
});

export function meRoutes(api: Api): void {
  api.get('/me', { own: true }, (_req, res) => {
    res.json({ data: meResource(res.locals.auth!) });
  });

  api.get('/me/menus', { own: true }, async (_req, res) => {
    const menus = await res.locals.models().Menu.find({}).lean();
    res.json({ data: menuTree(menus, res.locals.auth!) });
  });

  api.patch('/me', { own: true }, async (req, res) => {
    const auth = res.locals.auth!;
    const body = parse(updateProfileSchema, req.body);
    const m = res.locals.models();
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set.name = body.name;

    if (body.password !== undefined) {
      if (!body.current_password) throw validationError({ current_password: ['The current password is required to set a new one.'] });
      const user = await m.User.findOne({ _id: auth.user.id }).lean();
      if (!user || !(await verifyPassword(body.current_password, user.password_hash))) {
        throw validationError({ current_password: ['The current password is incorrect.'] });
      }
      if (body.password !== body.password_confirmation) throw validationError({ password: ['The password confirmation does not match.'] });
      if (body.password === body.current_password) throw validationError({ password: ['The new password must be different from the current one.'] });
      set.password_hash = await hashPassword(body.password);
      set.password_changed_at = new Date();
    } else if (body.current_password !== undefined || body.password_confirmation !== undefined) {
      throw validationError({ password: ['The password field is required.'] });
    }

    if (Object.keys(set).length) await m.User.updateOne({ _id: auth.user.id }, { $set: set });
    // A password change signs the user out everywhere: every refresh token is revoked.
    if (body.password !== undefined) {
      await m.RefreshToken.updateMany({ user_id: auth.user.id, revoked_at: null }, { $set: { revoked_at: new Date() } });
    }
    const fresh = body.name !== undefined ? { ...auth, user: { ...auth.user, name: body.name } } : auth;
    res.json({ data: meResource(fresh) });
  });
}

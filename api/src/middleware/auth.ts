import type { RequestHandler } from 'express';
import { permissionNames, SUPERADMIN_ROLE } from '../access/modules.ts';
import { verifyAccessToken } from '../auth/tokens.ts';
import type { Env } from '../env.ts';
import { forbidden, unauthenticated } from '../errors.ts';

export interface Auth {
  user: { id: number; name: string; email: string; role_ids: number[] };
  roleNames: string[];
  isSuperadmin: boolean;
  /** Every permission name the user holds (the superadmin holds the whole registry). */
  permissions: Set<string>;
  can: (permission: string) => boolean;
}

/** Bearer JWT -> user + roles in one aggregate. 401 for anything invalid, expired or inactive. */
export const authenticate = (env: Env): RequestHandler => async (req, res, next) => {
  try {
    const header = req.get('authorization') ?? '';
    const m = /^Bearer (\S+)$/i.exec(header);
    const claims = m ? await verifyAccessToken(env, m[1]!) : null;
    if (!claims) throw unauthenticated();

    const { User } = res.locals.models();
    const [row] = await User.aggregate<{
      _id: number; name: string; email: string; role_ids: number[]; is_active: boolean; password_changed_at?: Date | null;
      roles: { name: string; permissions: string[] }[];
    }>([
      { $match: { _id: claims.id } },
      { $lookup: { from: 'roles', localField: 'role_ids', foreignField: '_id', as: 'roles' } },
    ]);
    if (!row || !row.is_active) throw unauthenticated();
    // A password change signs the user out everywhere: access tokens issued in an earlier second stop working at once,
    // not only after their 15 minutes (refresh tokens are revoked at the same time).
    if (row.password_changed_at && claims.iat < Math.floor(row.password_changed_at.getTime() / 1000)) throw unauthenticated();

    const roleNames = row.roles.map((r) => r.name).sort();
    const isSuperadmin = roleNames.includes(SUPERADMIN_ROLE);
    const permissions = new Set<string>(isSuperadmin ? permissionNames() : row.roles.flatMap((r) => r.permissions));
    res.locals.auth = {
      user: { id: row._id, name: row.name, email: row.email, role_ids: row.role_ids },
      roleNames,
      isSuperadmin,
      permissions,
      can: (p) => isSuperadmin || permissions.has(p),
    } satisfies Auth;
    next();
  } catch (e) {
    next(e);
  }
};

/** Permission gate: 403 unless the user holds it (the superadmin bypasses). Runs after authenticate. */
export const can = (permission: string): RequestHandler => (_req, res, next) =>
  res.locals.auth!.can(permission) ? next() : next(forbidden());

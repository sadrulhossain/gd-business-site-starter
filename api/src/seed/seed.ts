import { menuPermission, modules, permissionNames, roleGrants, SUPERADMIN_ROLE } from '../access/modules.ts';
import { hashPassword } from '../auth/password.ts';
import { DEFAULT_SECTIONS } from '../modules/sections/routes.ts';
import { settingDefaults } from '../modules/settings/routes.ts';
import { ensureIndexes, nextId, type Models } from '../models.ts';

export interface SeedOptions {
  superadmin?: { name?: string; email?: string; password?: string };
}

/**
 * Idempotent. Everything is create-if-missing ($setOnInsert semantics): a re-run never overwrites roles, menus
 * or users that were edited since. The permission registry itself lives in code (src/access/modules.ts).
 */
export async function seedAccess(m: Models, opts: SeedOptions = {}): Promise<{ superadmin: 'created' | 'exists' | 'skipped' }> {
  await ensureIndexes(m);

  // Roles: superadmin (no stored permissions, bypasses every check) and the granted ones.
  const roleIds = new Map<string, number>();
  for (const name of [SUPERADMIN_ROLE, 'admin', ...Object.keys(roleGrants)]) {
    if (roleIds.has(name)) continue;
    const existing = await m.Role.findOne({ name }).lean();
    if (existing) {
      roleIds.set(name, existing._id);
      continue;
    }
    const role = await m.Role.create({ _id: await nextId(m, 'roles'), name, permissions: roleGrants[name] ?? [] });
    roleIds.set(name, role._id);
  }

  // Menus: group rows keyed by (title, no permission), leaf rows by their permission.
  const registry = new Set(permissionNames());
  for (const mod of modules) {
    if (!mod.menu) continue;
    const permission = menuPermission(mod);
    if (!registry.has(permission)) throw new Error(`module ${mod.key} has a menu but no view action`);
    let parentId: number | null = null;
    if (mod.menu.group) {
      const g = mod.menu.group;
      const found = await m.Menu.findOne({ permission_name: null, parent_id: null, title: g.title }).lean();
      parentId = found?._id ?? (await m.Menu.create({ _id: await nextId(m, 'menus'), title: g.title, sort: g.sort })).toObject()._id;
    }
    if (!(await m.Menu.exists({ permission_name: permission }))) {
      await m.Menu.create({
        _id: await nextId(m, 'menus'),
        parent_id: parentId,
        permission_name: permission,
        title: mod.menu.title,
        path: mod.menu.path,
        icon: mod.menu.icon ?? null,
        sort: mod.menu.sort,
      });
    }
  }

  // Content: the settings singleton and the default sections, create-if-missing.
  await m.Setting.updateOne({ _id: 1 }, { $setOnInsert: settingDefaults() }, { upsert: true, setDefaultsOnInsert: true });
  let order = 0;
  for (const [key, title, visible] of DEFAULT_SECTIONS) {
    order += 10;
    if (!(await m.Section.exists({ key }))) await m.Section.create({ _id: await nextId(m, 'sections'), key, title, sort_order: order, is_visible: visible });
  }

  // Superadmin user: only when email and password are given; never resets an existing user's password.
  const s = opts.superadmin;
  if (!s?.email || !s.password) return { superadmin: 'skipped' };
  const email = s.email.trim().toLowerCase();
  const rootRole = roleIds.get(SUPERADMIN_ROLE)!;
  const user = await m.User.findOne({ email }).lean();
  if (user) {
    await m.User.updateOne({ _id: user._id }, { $addToSet: { role_ids: rootRole } });
    return { superadmin: 'exists' };
  }
  await m.User.create({
    _id: await nextId(m, 'users'),
    name: s.name || 'Super Admin',
    email,
    password_hash: await hashPassword(s.password),
    role_ids: [rootRole],
  });
  return { superadmin: 'created' };
}

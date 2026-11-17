/**
 * Permission registry: one entry per module. It feeds the seeder (roles, menus), GET /v1/permissions
 * and the can() middleware. Permission names are <module>.<action>, as in the legacy kit.
 */
export const SUPERADMIN_ROLE = 'superadmin';

export interface MenuEntry {
  title: string;
  path: string;
  icon?: string;
  sort: number;
  /** Parent group row (shown only while a child is visible). */
  group?: { title: string; sort: number };
}

export interface ModuleDef {
  key: string;
  actions: string[];
  menu?: MenuEntry;
}

export const modules: ModuleDef[] = [
  { key: 'dashboard', actions: ['view'], menu: { title: 'Dashboard', path: '/', icon: 'home', sort: 0 } },
  { key: 'users', actions: ['view', 'create', 'update', 'delete'], menu: { title: 'Users', path: '/users', icon: 'users', sort: 10, group: { title: 'Access', sort: 80 } } },
  { key: 'roles', actions: ['view', 'create', 'update', 'delete'], menu: { title: 'Roles', path: '/roles', icon: 'shield', sort: 20, group: { title: 'Access', sort: 80 } } },
  { key: 'menus', actions: ['view', 'update'], menu: { title: 'Menus', path: '/menus', icon: 'list', sort: 30, group: { title: 'Access', sort: 80 } } },
];

export const permissionNames = (): string[] => modules.flatMap((m) => m.actions.map((a) => `${m.key}.${a}`)).sort();

/** Permissions given to a role on first seed (never re-applied, so edits stick). */
export const roleGrants: Record<string, string[]> = { admin: ['dashboard.view'] };

/** The menu permission of a module is its view action. */
export const menuPermission = (m: ModuleDef): string => `${m.key}.view`;

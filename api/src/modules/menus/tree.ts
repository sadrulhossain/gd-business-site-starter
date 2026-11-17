import type { Auth } from '../../middleware/auth.ts';
import type { MenuDoc } from '../../models.ts';

export interface MenuNode {
  id: number;
  title: string;
  icon: string | null;
  path: string | null;
  permission_name: string | null;
  children: MenuNode[];
}

/** Port of legacy MenuTree: a group row (no permission) shows only with a visible child. */
export function menuTree(menus: MenuDoc[], auth: Auth): MenuNode[] {
  const byParent = new Map<number, MenuDoc[]>();
  for (const m of [...menus].sort((a, b) => a.sort - b.sort || a._id - b._id)) {
    const k = m.parent_id ?? 0;
    byParent.set(k, [...(byParent.get(k) ?? []), m]);
  }
  const branch = (parent: number): MenuNode[] => {
    const out: MenuNode[] = [];
    for (const m of byParent.get(parent) ?? []) {
      const children = branch(m._id);
      const visible = m.permission_name === null ? children.length > 0 : auth.can(m.permission_name);
      if (!visible) continue;
      out.push({ id: m._id, title: m.title, icon: m.icon, path: m.path, permission_name: m.permission_name, children });
    }
    return out;
  };
  return branch(0);
}

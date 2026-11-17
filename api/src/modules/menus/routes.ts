import { inList } from '../../db.ts';
import { idParam } from '../../http/helpers.ts';
import type { Api } from '../../http/route.ts';
import { parse, validationError } from '../../http/validate.ts';
import { notFoundError } from '../../errors.ts';
import type { MenuDoc } from '../../models.ts';
import { reorderSchema, updateMenuSchema } from './schema.ts';

const toResource = (m: MenuDoc, depth = 0) => ({
  id: m._id, parent_id: m.parent_id, depth, title: m.title, icon: m.icon, path: m.path, permission_name: m.permission_name, sort: m.sort,
});

export function menuRoutes(api: Api): void {
  // Whole tree, depth-first, so the UI can indent without rebuilding it.
  api.get('/menus', { permission: 'menus.view' }, async (_req, res) => {
    const all = await res.locals.models().Menu.find({}).sort({ sort: 1, _id: 1 }).lean();
    const byParent = new Map<number, MenuDoc[]>();
    for (const m of all) byParent.set(m.parent_id ?? 0, [...(byParent.get(m.parent_id ?? 0) ?? []), m]);
    const rows: ReturnType<typeof toResource>[] = [];
    const walk = (parent: number, depth: number): void => {
      for (const m of byParent.get(parent) ?? []) {
        rows.push(toResource(m, depth));
        walk(m._id, depth + 1);
      }
    };
    walk(0, 0);
    res.json({ data: rows });
  });

  // Registered before /menus/:id so "reorder" is never read as an id.
  api.put('/menus/reorder', { permission: 'menus.update' }, async (req, res) => {
    const { ids } = parse(reorderSchema, req.body);
    if (new Set(ids).size !== ids.length) throw validationError({ ids: ['Entries must be distinct.'] });
    const { Menu } = res.locals.models();
    const found = await Menu.find({ _id: inList(ids) }).lean();
    const known = new Set(found.map((m) => m._id));
    const missing = ids.findIndex((id) => !known.has(id));
    if (missing >= 0) throw validationError({ [`ids.${missing}`]: ['The selected entry is invalid.'] });
    if (new Set(found.map((m) => m.parent_id)).size > 1) throw validationError({ ids: ['Menu entries must share one parent.'] });
    await Menu.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { sort: (i + 1) * 10 } } } })));
    res.json({ data: { reordered: ids.length } });
  });

  api.patch('/menus/:id', { permission: 'menus.update' }, async (req, res) => {
    const id = idParam(req);
    const body = parse(updateMenuSchema, req.body);
    const { Menu } = res.locals.models();
    const menu = await Menu.findOneAndUpdate({ _id: id }, { $set: body }, { returnDocument: 'after' }).lean();
    if (!menu) throw notFoundError();
    res.json({ data: toResource(menu) });
  });
}

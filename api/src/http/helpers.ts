import type { Request } from 'express';
import type { Model } from 'mongoose';
import { notFoundError } from '../errors.ts';

/** Route id parameter: a positive integer or 404. */
export function idParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  const id = typeof raw === 'string' && /^\d{1,12}$/.test(raw) ? Number(raw) : 0;
  if (id < 1) throw notFoundError();
  return id;
}

export const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export interface Page<T> {
  data: T[];
  links: { first: string; last: string; prev: string | null; next: string | null };
  meta: { current_page: number; from: number | null; last_page: number; per_page: number; to: number | null; total: number };
}

/** Laravel-shaped pagination ({data, links, meta}) so the admin list screens keep working. */
export async function paginate<D, T>(model: Model<D>, base: string, page: number, perPage: number, map: (rows: D[]) => Promise<T[]> | T[], sort: Record<string, 1 | -1> = { _id: 1 }): Promise<Page<T>> {
  const total = await model.countDocuments({});
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const rows = (await model.find({}).sort(sort).skip((page - 1) * perPage).limit(perPage).lean()) as D[];
  const data = await map(rows);
  const url = (p: number) => `${base}?page=${p}`;
  return {
    data,
    links: { first: url(1), last: url(lastPage), prev: page > 1 ? url(page - 1) : null, next: page < lastPage ? url(page + 1) : null },
    meta: { current_page: page, from: data.length ? (page - 1) * perPage + 1 : null, last_page: lastPage, per_page: perPage, to: data.length ? (page - 1) * perPage + data.length : null, total },
  };
}

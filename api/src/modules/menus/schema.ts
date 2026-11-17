import { z } from '../../http/validate.ts';

export const updateMenuSchema = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
  icon: z.string().max(60).nullable().optional(),
});

export const reorderSchema = z.strictObject({
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

import { z } from '../../http/validate.ts';
import type { Env } from '../../env.ts';
import { describeImage } from '../../media/service.ts';
import type { ServiceDoc } from '../../models.ts';
import { bilingual } from '../../support/bilingual.ts';
import { orderFields, stamp } from '../../support/content.ts';

const text = { title: { max: 150, required: true }, description: { max: 5000 } } as const;
export const createService = z.strictObject({ ...bilingual(text, { partial: false }), ...orderFields });
export const updateService = z.strictObject({ ...bilingual(text), ...orderFields });

export const serviceResource = (env: Env, s: ServiceDoc) => ({
  id: s._id, title: s.title, title_2nd: s.title_2nd ?? null, description: s.description ?? null, description_2nd: s.description_2nd ?? null,
  image: describeImage(env, s.image), sort_order: s.sort_order, is_visible: s.is_visible, updated_at: stamp(s),
});

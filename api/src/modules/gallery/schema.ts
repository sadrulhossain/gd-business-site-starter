import { z } from '../../http/validate.ts';
import type { Env } from '../../env.ts';
import { describeImage } from '../../media/service.ts';
import type { GalleryItemDoc } from '../../models.ts';
import { bilingual } from '../../support/bilingual.ts';
import { orderFields, stamp } from '../../support/content.ts';

const text = { title: { max: 150 }, caption: { max: 255 } } as const;
export const createGalleryItem = z.strictObject({ ...bilingual(text, { partial: false }), ...orderFields });
export const updateGalleryItem = z.strictObject({ ...bilingual(text), ...orderFields });

export const galleryItemResource = (env: Env, g: GalleryItemDoc) => ({
  id: g._id, title: g.title ?? null, title_2nd: g.title_2nd ?? null, caption: g.caption ?? null, caption_2nd: g.caption_2nd ?? null,
  image: describeImage(env, g.image), sort_order: g.sort_order, is_visible: g.is_visible, updated_at: stamp(g),
});

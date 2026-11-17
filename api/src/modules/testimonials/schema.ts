import { z } from '../../http/validate.ts';
import type { Env } from '../../env.ts';
import { describeImage } from '../../media/service.ts';
import type { TestimonialDoc } from '../../models.ts';
import { bilingual } from '../../support/bilingual.ts';
import { orderFields, stamp } from '../../support/content.ts';

const text = { author_role: { max: 100 }, quote: { max: 2000, required: true } } as const;
// author_name is single-language in legacy (no author_name_2nd).
const authorName = z.string().trim().min(1).max(100);
export const createTestimonial = z.strictObject({ author_name: authorName, ...bilingual(text, { partial: false }), ...orderFields });
export const updateTestimonial = z.strictObject({ author_name: authorName.optional(), ...bilingual(text), ...orderFields });

export const testimonialResource = (env: Env, t: TestimonialDoc) => ({
  id: t._id, author_name: t.author_name, author_role: t.author_role ?? null, author_role_2nd: t.author_role_2nd ?? null,
  quote: t.quote, quote_2nd: t.quote_2nd ?? null, image: describeImage(env, t.image),
  sort_order: t.sort_order, is_visible: t.is_visible, updated_at: stamp(t),
});

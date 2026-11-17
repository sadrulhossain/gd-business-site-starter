import { z } from '../../http/validate.ts';
import type { Env } from '../../env.ts';
import type { FaqDoc } from '../../models.ts';
import { bilingual } from '../../support/bilingual.ts';
import { orderFields, stamp } from '../../support/content.ts';

const text = { question: { max: 255, required: true }, answer: { max: 10000, required: true } } as const;
export const createFaq = z.strictObject({ ...bilingual(text, { partial: false }), ...orderFields });
export const updateFaq = z.strictObject({ ...bilingual(text), ...orderFields });

export const faqResource = (_env: Env, f: FaqDoc) => ({
  id: f._id, question: f.question, question_2nd: f.question_2nd ?? null, answer: f.answer, answer_2nd: f.answer_2nd ?? null,
  sort_order: f.sort_order, is_visible: f.is_visible, updated_at: stamp(f),
});

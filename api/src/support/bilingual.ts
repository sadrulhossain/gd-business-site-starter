import { z } from '../http/validate.ts';

/** '' means "no value" for optional text (Laravel's ConvertEmptyStringsToNull). */
const emptyToNull = (v: string | null | undefined) => (v === '' ? null : v);

export interface TextSpec {
  max: number;
  /** Must be present and non-empty when sent (PATCH) or always (create, `partial: false`). */
  required?: boolean;
}

/**
 * zod equivalent of the legacy Bilingual::rules. For every field x it returns x and x_2nd; the second language
 * is always optional and nullable, with the same maximum length. Spread the result into z.strictObject({...}).
 *
 * partial (default true) = update semantics ("sometimes"): a required field may be omitted but not emptied.
 */
export function bilingual<K extends string>(spec: Record<K, TextSpec>, opts: { partial?: boolean } = {}) {
  const partial = opts.partial ?? true;
  const shape: Record<string, z.ZodType> = {};
  for (const [field, s] of Object.entries(spec) as [K, TextSpec][]) {
    const base = z.string().max(s.max);
    shape[field] = s.required
      ? partial ? base.trim().min(1).optional() : base.trim().min(1)
      : base.nullable().optional().transform(emptyToNull);
    shape[`${field}_2nd`] = base.nullable().optional().transform(emptyToNull);
  }
  return shape as Record<K | `${K}_2nd`, z.ZodType>;
}

/** Optional single-language text. */
export const optionalText = (max: number) => z.string().max(max).nullable().optional().transform(emptyToNull);

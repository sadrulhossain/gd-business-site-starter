import { z } from 'zod';
import { HttpError } from '../errors.ts';

/** Builds the legacy 422 envelope: {error:{code:'unprocessable', message, details:{field:[messages]}}}. */
export function validationError(details: Record<string, string[]>): HttpError {
  const first = Object.values(details)[0]?.[0] ?? 'The given data was invalid.';
  return new HttpError(422, 'unprocessable', first, details);
}

/** Parses with a zod schema. Schemas are .strict(): unknown keys are rejected. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  // No prototype: a client-chosen key such as __proto__ must be an ordinary key, not Object.prototype.
  const details: Record<string, string[]> = Object.create(null);
  const add = (key: string, msg: string) => (details[key] ??= []).push(msg);
  for (const issue of r.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys) add([...issue.path, k].join('.'), 'This field is not allowed.');
    } else {
      add(issue.path.join('.') || '_', issue.message);
    }
  }
  throw validationError(details);
}

export { z };

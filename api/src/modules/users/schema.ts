import { MAX_LENGTH, MIN_LENGTH } from '../../auth/password.ts';
import { z } from '../../http/validate.ts';

const name = z.string().trim().min(1).max(120);
const email = z.string().trim().toLowerCase().pipe(z.email().max(255));
const password = z.string().min(MIN_LENGTH, `The password must be at least ${MIN_LENGTH} characters.`).max(MAX_LENGTH);
const roles = z.array(z.string().max(60));

export const storeUserSchema = z.strictObject({ name, email, password, roles: roles.optional() });
export const updateUserSchema = z.strictObject({ name: name.optional(), email: email.optional(), password: password.nullable().optional(), roles: roles.optional() });
export const listQuerySchema = z.strictObject({ page: z.coerce.number().int().min(1).max(100000).default(1) });

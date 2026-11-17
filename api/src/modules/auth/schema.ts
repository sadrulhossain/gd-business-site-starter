import { z } from '../../http/validate.ts';

export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(1).max(255),
  password: z.string().min(1).max(255),
});

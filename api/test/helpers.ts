import mongoose from 'mongoose';
import supertest from 'supertest';
import { SUPERADMIN_ROLE } from '../src/access/modules.ts';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { signAccessToken } from '../src/auth/tokens.ts';
import '../src/db.ts';
import type { Env } from '../src/env.ts';
import { ensureIndexes, getModels, nextId, type Models } from '../src/models.ts';

export const PASSWORD = 'a-long-test-password';

export const testEnv = (over: Partial<Env> = {}): Env => ({
  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://mongo:27017',
  MONGODB_DB: `${process.env.MONGODB_DB ?? 'gd-business-site-starter'}_testing`,
  APP_DEBUG: 'false',
  SITE_ORIGIN: 'http://site.test',
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0001',
  REFRESH_TOKEN_PEPPER: 'test-pepper-test-pepper-test-pepper-0001',
  COOKIE_NAME: 'rt',
  LOCALE_DEFAULT: 'en',
  LOCALE_FALLBACK: 'en',
  LOCALE_SUPPORTED: 'en',
  ...over,
});

export const client = (over: Partial<Env> = {}) => supertest(createApp(testEnv(over)));

/** Direct connection to the testing database, emptied by reset() (never the dev database). */
export function useDb() {
  const conn = mongoose.createConnection(testEnv().MONGODB_URI, { dbName: testEnv().MONGODB_DB });
  const m = getModels(conn);
  return {
    m,
    conn,
    async reset() {
      await conn.asPromise();
      await conn.dropDatabase();
      await ensureIndexes(m);
    },
    close: () => conn.close(),
  };
}

let seq = 0;

/** Creates a role (with permissions) and a user holding it; returns a bearer header for the user. */
export async function actingAs(m: Models, roleName: string, permissions: string[] = [], over: { is_active?: boolean; password?: string } = {}) {
  let role = await m.Role.findOne({ name: roleName }).lean();
  if (!role) role = (await m.Role.create({ _id: await nextId(m, 'roles'), name: roleName, permissions })).toObject();
  const user = (
    await m.User.create({
      _id: await nextId(m, 'users'),
      name: `User ${++seq}`,
      email: `user${seq}-${roleName}@example.test`,
      password_hash: await hashPassword(over.password ?? PASSWORD),
      role_ids: [role._id],
      is_active: over.is_active ?? true,
    })
  ).toObject();
  const { token } = await signAccessToken(testEnv(), user._id);
  return { user, role, token, auth: { Authorization: `Bearer ${token}` } };
}

export const actingAsSuperadmin = (m: Models) => actingAs(m, SUPERADMIN_ROLE);

/** Pulls the refresh token out of a response's Set-Cookie header (tests only). */
export function refreshCookie(res: { headers: Record<string, unknown> }, name = 'rt'): string | null {
  const raw = res.headers['set-cookie'] as string[] | undefined;
  const line = raw?.find((c) => c.startsWith(`${name}=`));
  return line ? line.split(';')[0]!.slice(name.length + 1) : null;
}

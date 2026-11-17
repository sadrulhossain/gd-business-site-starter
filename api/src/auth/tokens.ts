import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { accessTtlSeconds, type Env } from '../env.ts';
import { HttpError } from '../errors.ts';

function secret(value: string | undefined, name: string): string {
  if (!value || value.length < 32) throw new HttpError(500, 'server_error', `${name} is not configured.`);
  return value;
}

const accessKey = (env: Env) => new TextEncoder().encode(secret(env.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET'));

/** HS256 access token: sub, iat, exp, jti. No permissions inside; they are loaded per request. */
export async function signAccessToken(env: Env, userId: number): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = accessTtlSeconds(env);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setJti(randomUUID())
    .sign(accessKey(env));
  return { token, expiresIn };
}

/** Returns the user id, or null for any invalid, expired or malformed token. */
export async function verifyAccessToken(env: Env, token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey(env), { algorithms: ['HS256'] });
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** 32 random bytes, base64url. Only its HMAC is stored. */
export const newRefreshToken = (): string => randomBytes(32).toString('base64url');

export const hashRefreshToken = (env: Env, token: string): string =>
  createHmac('sha256', secret(env.REFRESH_TOKEN_PEPPER, 'REFRESH_TOKEN_PEPPER')).update(token).digest('hex');

export const newFamilyId = (): string => randomUUID();

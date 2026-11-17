import { timingSafeEqual } from 'node:crypto';

/**
 * Password hashes are self-describing: $pbkdf2-sha256$i=<iterations>$<salt>$<hash> (base64url), so the algorithm
 * and cost can be upgraded later and old hashes are rehashed on login (needsRehash).
 *
 * PROVISIONAL (ADR 016): WebCrypto PBKDF2-SHA256 is the only native option on Workers, and workerd caps its
 * iteration count at 100,000. Spike a (docs/SPIKES.md) still has to confirm the CPU cost on a deployed free Worker.
 */
export const ALGORITHM = 'pbkdf2-sha256';
export const TARGET_ITERATIONS = 100_000;
export const MIN_LENGTH = 12;
export const MAX_LENGTH = 255;

const enc = new TextEncoder();

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64url');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

export async function hashPassword(password: string, iterations = TARGET_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `$${ALGORITHM}$i=${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

function parse(stored: string): { iterations: number; salt: Uint8Array<ArrayBuffer>; hash: Uint8Array } | null {
  const m = /^\$pbkdf2-sha256\$i=(\d{1,9})\$([\w-]+)\$([\w-]+)$/.exec(stored);
  if (!m) return null;
  return { iterations: Number(m[1]), salt: fromB64(m[2]!) as Uint8Array<ArrayBuffer>, hash: fromB64(m[3]!) };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const p = parse(stored);
  if (!p) return false;
  const got = await derive(password, p.salt, p.iterations);
  return got.length === p.hash.length && timingSafeEqual(got, p.hash);
}

export function needsRehash(stored: string): boolean {
  const p = parse(stored);
  return !p || p.iterations < TARGET_ITERATIONS;
}

let dummy: Promise<string> | undefined;
/** Burns the same work as a real check, so an unknown email takes as long as a wrong password. */
export async function verifyDummy(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummy);
}

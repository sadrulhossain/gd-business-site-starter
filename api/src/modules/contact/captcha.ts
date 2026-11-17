import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { after } from '../../db.ts';
import { captchaTtlSeconds, type Env } from '../../env.ts';
import type { Models } from '../../models.ts';

/** Arithmetic captcha stored in the captchas collection (TTL index on expires_at). */
export async function issueCaptcha(env: Env, m: Models): Promise<{ id: string; question: string }> {
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const id = randomUUID();
  await m.Captcha.create({ _id: id, answer: a + b, expires_at: new Date(Date.now() + captchaTtlSeconds(env) * 1000) });
  return { id, question: `${a} + ${b}` };
}

const same = (a: number, b: number): boolean => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  const len = Math.max(x.length, y.length);
  // Pad to one length so the comparison time does not depend on the answer.
  return timingSafeEqual(Buffer.concat([x, Buffer.alloc(len - x.length)]), Buffer.concat([y, Buffer.alloc(len - y.length)])) && x.length === y.length;
};

/**
 * One atomic findOneAndDelete on the id that also requires expires_at in the future: the token works once, and an
 * expired token is refused even before the TTL monitor removes it. The captcha is consumed whatever the answer is.
 */
export async function checkCaptcha(m: Models, id: string, answer: number, now = new Date()): Promise<boolean> {
  const doc = await m.Captcha.findOneAndDelete({ _id: id, expires_at: after(now) }).lean();
  return doc !== null && same(doc.answer, answer);
}

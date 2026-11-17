import type { Request, RequestHandler } from 'express';
import { hashPassword, needsRehash, verifyDummy, verifyPassword } from '../../auth/password.ts';
import { hashRefreshToken, newFamilyId, newRefreshToken, signAccessToken } from '../../auth/tokens.ts';
import { before } from '../../db.ts';
import { cookieName, refreshTtlDays, trustedOrigins, type Env } from '../../env.ts';
import { forbidden, HttpError } from '../../errors.ts';
import { clearRefreshCookie, readCookie, setRefreshCookie } from '../../http/cookies.ts';
import { clientIp, hit } from '../../http/rateLimit.ts';
import type { Api } from '../../http/route.ts';
import { parse } from '../../http/validate.ts';
import { nextId } from '../../models.ts';
import { loginSchema } from './schema.ts';

const BAD_CREDENTIALS = 'These credentials do not match our records.';
const invalid = () => new HttpError(401, 'invalid_credentials', BAD_CREDENTIALS);

/** Cookie endpoints need a custom header and a trusted Origin (CSRF defence on top of SameSite=Lax). */
function assertBrowserCall(env: Env, req: Request): void {
  if (req.get('x-requested-with') !== 'gd-admin') throw forbidden('Missing X-Requested-With header.');
  const origin = req.get('origin');
  if (!origin || !trustedOrigins(env).includes(origin)) throw forbidden('Origin not allowed.');
}

export function authRoutes(api: Api, env: Env): void {
  const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };

  api.post('/auth/login', { public: true }, noStore, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    // 10 per minute per IP and per email (the legacy limits).
    await hit(req, res, 'login-ip', clientIp(req), 10, 60);
    await hit(req, res, 'login-email', email, 10, 60);

    const m = res.locals.models();
    const user = await m.User.findOne({ email }).lean();
    if (!user) {
      await verifyDummy(password);
      throw invalid();
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok || !user.is_active) throw invalid();
    if (needsRehash(user.password_hash)) {
      await m.User.updateOne({ _id: user._id }, { $set: { password_hash: await hashPassword(password) } });
    }

    const refresh = newRefreshToken();
    await m.RefreshToken.create({
      _id: await nextId(m, 'refresh_tokens'),
      user_id: user._id,
      family_id: newFamilyId(),
      token_hash: hashRefreshToken(env, refresh),
      expires_at: new Date(Date.now() + refreshTtlDays(env) * 86_400_000),
    });
    setRefreshCookie(env, res, refresh);
    const { token, expiresIn } = await signAccessToken(env, user._id);
    res.json({ access_token: token, token_type: 'Bearer', expires_in: expiresIn });
  });

  api.post('/auth/refresh', { public: true }, noStore, async (req, res) => {
    assertBrowserCall(env, req);
    const presented = readCookie(req, cookieName(env));
    if (!presented) throw new HttpError(401, 'unauthenticated', 'Unauthenticated.');

    const m = res.locals.models();
    const hash = hashRefreshToken(env, presented);
    const now = new Date();
    const row = await m.RefreshToken.findOne({ token_hash: hash }).lean();
    const fail = (): never => {
      clearRefreshCookie(env, res);
      throw new HttpError(401, 'unauthenticated', 'Unauthenticated.');
    };
    if (!row || row.revoked_at || row.expires_at <= now) return fail();

    // Atomic rotation: only one request can mark the token used. A second presentation is reuse.
    const claimed = await m.RefreshToken.findOneAndUpdate({ _id: row._id, used_at: null }, { $set: { used_at: now } }).lean();
    if (!claimed) {
      await m.RefreshToken.updateMany({ family_id: row.family_id, revoked_at: null }, { $set: { revoked_at: now } });
      return fail();
    }
    const user = await m.User.findOne({ _id: row.user_id }).lean();
    if (!user || !user.is_active) {
      await m.RefreshToken.updateMany({ family_id: row.family_id, revoked_at: null }, { $set: { revoked_at: now } });
      return fail();
    }

    const next = newRefreshToken();
    await m.RefreshToken.create({
      _id: await nextId(m, 'refresh_tokens'),
      user_id: user._id,
      family_id: row.family_id,
      token_hash: hashRefreshToken(env, next),
      expires_at: row.expires_at, // the family keeps its original lifetime
    });
    // Housekeeping: drop expired rows of this user (the TTL index also does this, lazily).
    await m.RefreshToken.deleteMany({ user_id: user._id, expires_at: before(now) });
    setRefreshCookie(env, res, next);
    const { token, expiresIn } = await signAccessToken(env, user._id);
    res.json({ access_token: token, token_type: 'Bearer', expires_in: expiresIn });
  });

  // Public on purpose: the access token may already have expired, so the refresh cookie identifies the family.
  api.post('/logout', { public: true }, noStore, async (req, res) => {
    assertBrowserCall(env, req);
    const presented = readCookie(req, cookieName(env));
    if (presented) {
      const m = res.locals.models();
      const row = await m.RefreshToken.findOne({ token_hash: hashRefreshToken(env, presented) }).lean();
      if (row) await m.RefreshToken.updateMany({ family_id: row.family_id, revoked_at: null }, { $set: { revoked_at: new Date() } });
    }
    clearRefreshCookie(env, res);
    res.status(204).end();
  });
}

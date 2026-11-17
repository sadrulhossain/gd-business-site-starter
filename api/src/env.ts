/** Worker bindings: plain vars and secrets, all strings (docs/ENV.md). */
export interface Env {
  MONGODB_URI: string;
  MONGODB_DB: string;
  APP_ENV?: string;
  APP_DEBUG?: string;
  CORS_ALLOWED_ORIGINS?: string;
  SITE_ORIGIN?: string;
  JWT_ACCESS_SECRET?: string;
  REFRESH_TOKEN_PEPPER?: string;
  COOKIE_NAME?: string;
  ACCESS_TOKEN_TTL_SECONDS?: string;
  REFRESH_TOKEN_TTL_DAYS?: string;
  LOCALE_DEFAULT?: string;
  LOCALE_FALLBACK?: string;
  LOCALE_SUPPORTED?: string;
}

export const isDebug = (env: Env): boolean => env.APP_DEBUG === 'true';

const list = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const corsOrigins = (env: Env): string[] => list(env.CORS_ALLOWED_ORIGINS);
/** Origins allowed to call the cookie endpoints: the site itself plus local development origins. */
export const trustedOrigins = (env: Env): string[] => [...(env.SITE_ORIGIN ? [env.SITE_ORIGIN] : []), ...corsOrigins(env)];
export const cookieName = (env: Env): string => env.COOKIE_NAME || '__Host-rt';
export const accessTtlSeconds = (env: Env): number => num(env.ACCESS_TOKEN_TTL_SECONDS, 900);
export const refreshTtlDays = (env: Env): number => num(env.REFRESH_TOKEN_TTL_DAYS, 30);

export interface Locales {
  default: string;
  fallback: string;
  supported: string[];
  second: string | null;
}

/** Ported from legacy config/locales.php: LOCALE_SUPPORTED is a comma list; "second" is the first non-default locale. */
export function locales(env: Env): Locales {
  const supported = list(env.LOCALE_SUPPORTED ?? 'en');
  const def = env.LOCALE_DEFAULT ?? 'en';
  return {
    default: def,
    fallback: env.LOCALE_FALLBACK ?? 'en',
    supported,
    second: supported.find((l) => l !== def) ?? null,
  };
}

/** Worker bindings: plain vars and secrets, all strings (docs/ENV.md). */
export interface Env {
  MONGODB_URI: string;
  MONGODB_DB: string;
  APP_ENV?: string;
  APP_DEBUG?: string;
  CORS_ALLOWED_ORIGINS?: string;
  LOCALE_DEFAULT?: string;
  LOCALE_FALLBACK?: string;
  LOCALE_SUPPORTED?: string;
}

export const isDebug = (env: Env): boolean => env.APP_DEBUG === 'true';

export interface Locales {
  default: string;
  fallback: string;
  supported: string[];
  second: string | null;
}

/** Ported from legacy config/locales.php: LOCALE_SUPPORTED is a comma list; "second" is the first non-default locale. */
export function locales(env: Env): Locales {
  const supported = (env.LOCALE_SUPPORTED ?? 'en').split(',').map((s) => s.trim()).filter(Boolean);
  const def = env.LOCALE_DEFAULT ?? 'en';
  return {
    default: def,
    fallback: env.LOCALE_FALLBACK ?? 'en',
    supported,
    second: supported.find((l) => l !== def) ?? null,
  };
}

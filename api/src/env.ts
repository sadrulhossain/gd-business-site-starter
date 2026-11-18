/** Worker bindings: plain vars and secrets, all strings (docs/ENV.md). */
export interface Env {
  /** Static assets binding (wrangler.jsonc at the repository root); absent in development and tests. */
  ASSETS?: Fetcher;
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
  UPLOADS_MAX_MB?: string;
  MEDIA_MAX_FILES?: string;
  MEDIA_BASE_PATH?: string;
  MEDIA_GIT_BRANCH?: string;
  GITHUB_REPO?: string;
  GITHUB_REPO_TOKEN?: string;
  CAPTCHA_TTL_SECONDS?: string;
  CONTACT_PER_MINUTE?: string;
  CONTACT_NOTIFY_TO?: string;
  MAIL_PROVIDER?: string;
  MAIL_API_URL?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM_ADDRESS?: string;
  NOTIFY_WEBHOOK_URL?: string;
  GITHUB_WORKFLOW_FILE?: string;
  GITHUB_REF?: string;
  PUBLISH_DEBOUNCE_MINUTES?: string;
  PUBLISH_QUIET_MINUTES?: string;
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

export const uploadsMaxBytes = (env: Env): number => num(env.UPLOADS_MAX_MB, 5) * 1024 * 1024;
export const mediaMaxFiles = (env: Env): number => Math.floor(num(env.MEDIA_MAX_FILES, 6000));
export const mediaBasePath = (env: Env): string => (env.MEDIA_BASE_PATH || '/media').replace(/\/+$/, '');
export const mediaBranch = (env: Env): string => env.MEDIA_GIT_BRANCH || 'main';

export const captchaTtlSeconds = (env: Env): number => num(env.CAPTCHA_TTL_SECONDS, 600);
export const contactPerMinute = (env: Env): number => Math.floor(num(env.CONTACT_PER_MINUTE, 5));
export const publishDebounceMinutes = (env: Env): number => num(env.PUBLISH_DEBOUNCE_MINUTES, 5);
export const publishQuietMinutes = (env: Env): number => num(env.PUBLISH_QUIET_MINUTES, 2);
export type MailProvider = 'none' | 'webhook' | 'http';
export const mailProvider = (env: Env): MailProvider => (env.MAIL_PROVIDER === 'webhook' || env.MAIL_PROVIDER === 'http' ? env.MAIL_PROVIDER : 'none');

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

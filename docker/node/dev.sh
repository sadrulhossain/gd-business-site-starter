#!/bin/sh
# One container, three dev servers: api (wrangler dev), web/admin (Vite), web/portal (Next), one pnpm workspace.
set -eu
cd /app
# node:*-slim has no CA bundle and workerd needs one (verified in M1).
[ -f /etc/ssl/certs/ca-certificates.crt ] || { apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates >/dev/null; }
corepack enable
echo "installing workspace deps"
if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile --reporter=silent
else pnpm install --reporter=silent; fi
trap 'kill 0' TERM INT
(cd /app/api && exec pnpm exec wrangler dev --ip 0.0.0.0 --port "$API_DEV_PORT" \
  --var "MONGODB_URI:$MONGODB_URI" "MONGODB_DB:$MONGODB_DB" "APP_ENV:$APP_ENV" "APP_DEBUG:$APP_DEBUG" \
  "CORS_ALLOWED_ORIGINS:$CORS_ALLOWED_ORIGINS" "LOCALE_DEFAULT:$LOCALE_DEFAULT" "LOCALE_FALLBACK:$LOCALE_FALLBACK" "LOCALE_SUPPORTED:$LOCALE_SUPPORTED" \
  "JWT_ACCESS_SECRET:$JWT_ACCESS_SECRET" "REFRESH_TOKEN_PEPPER:$REFRESH_TOKEN_PEPPER" "COOKIE_NAME:$COOKIE_NAME" "SITE_ORIGIN:$SITE_ORIGIN" \
  "ACCESS_TOKEN_TTL_SECONDS:$ACCESS_TOKEN_TTL_SECONDS" "REFRESH_TOKEN_TTL_DAYS:$REFRESH_TOKEN_TTL_DAYS" \
  "UPLOADS_MAX_MB:$UPLOADS_MAX_MB" "MEDIA_MAX_FILES:$MEDIA_MAX_FILES" "MEDIA_BASE_PATH:$MEDIA_BASE_PATH" "MEDIA_GIT_BRANCH:$MEDIA_GIT_BRANCH" \
  "GITHUB_REPO:$GITHUB_REPO" "GITHUB_REPO_TOKEN:$GITHUB_REPO_TOKEN" \n  "CAPTCHA_TTL_SECONDS:$CAPTCHA_TTL_SECONDS" "CONTACT_PER_MINUTE:$CONTACT_PER_MINUTE" "CONTACT_NOTIFY_TO:$CONTACT_NOTIFY_TO" "MAIL_PROVIDER:$MAIL_PROVIDER" "MAIL_API_URL:$MAIL_API_URL" "MAIL_API_KEY:$MAIL_API_KEY" "MAIL_FROM_ADDRESS:$MAIL_FROM_ADDRESS" "NOTIFY_WEBHOOK_URL:$NOTIFY_WEBHOOK_URL" "GITHUB_WORKFLOW_FILE:$GITHUB_WORKFLOW_FILE" "GITHUB_REF:$GITHUB_REF" "PUBLISH_DEBOUNCE_MINUTES:$PUBLISH_DEBOUNCE_MINUTES" "PUBLISH_QUIET_MINUTES:$PUBLISH_QUIET_MINUTES") &
(cd /app/web/admin && exec pnpm run dev) &
(cd /app/web/portal && exec pnpm run dev) &
wait

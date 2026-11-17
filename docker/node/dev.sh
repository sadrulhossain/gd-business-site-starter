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
  "CORS_ALLOWED_ORIGINS:$CORS_ALLOWED_ORIGINS" "LOCALE_DEFAULT:$LOCALE_DEFAULT" "LOCALE_FALLBACK:$LOCALE_FALLBACK" "LOCALE_SUPPORTED:$LOCALE_SUPPORTED") &
(cd /app/web/admin && exec pnpm run dev) &
(cd /app/web/portal && exec pnpm run dev) &
wait

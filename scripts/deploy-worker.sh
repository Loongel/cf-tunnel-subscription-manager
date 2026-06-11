#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_SECRET_FILE="${LOCAL_SECRET_FILE:-${ROOT_DIR}/.secrets/worker.env}"

if [[ -f "$LOCAL_SECRET_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$LOCAL_SECRET_FILE"
  set +a
fi

export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"

ADMIN_TOKEN="${ADMIN_TOKEN:?set ADMIN_TOKEN}"
AGENT_TOKEN="${AGENT_TOKEN:?set AGENT_TOKEN}"
SUBSCRIPTION_TOKEN="${SUBSCRIPTION_TOKEN:?set SUBSCRIPTION_TOKEN}"

cd "${ROOT_DIR}/worker"

echo "== installing worker dependencies =="
npm ci

echo "== typecheck and tests =="
npm run check
npm test

echo "== applying D1 migrations =="
npm run d1:migrate:remote

echo "== setting Worker secrets =="
printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN
printf '%s' "$AGENT_TOKEN" | npx wrangler secret put AGENT_TOKEN
printf '%s' "$SUBSCRIPTION_TOKEN" | npx wrangler secret put SUBSCRIPTION_TOKEN

echo "== deploying Worker =="
npm run deploy

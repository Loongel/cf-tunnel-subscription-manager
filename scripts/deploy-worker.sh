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
export ADMIN_TOKEN AGENT_TOKEN SUBSCRIPTION_TOKEN
DEPLOY_CLOUDFLARE_ATTEMPTS="${DEPLOY_CLOUDFLARE_ATTEMPTS:-3}"

retry_cloudflare() {
  local label="$1"
  shift
  local attempt
  for ((attempt = 1; attempt <= DEPLOY_CLOUDFLARE_ATTEMPTS; attempt++)); do
    if [[ "$DEPLOY_CLOUDFLARE_ATTEMPTS" -gt 1 ]]; then
      echo "== ${label} attempt ${attempt}/${DEPLOY_CLOUDFLARE_ATTEMPTS} =="
    fi
    if "$@"; then
      return 0
    fi
    if [[ "$attempt" -lt "$DEPLOY_CLOUDFLARE_ATTEMPTS" ]]; then
      echo "${label} failed; retrying."
      sleep $((attempt * 5))
    fi
  done
  echo "${label} failed after ${DEPLOY_CLOUDFLARE_ATTEMPTS} attempts." >&2
  return 1
}

cd "${ROOT_DIR}/worker"

echo "== installing worker dependencies =="
npm ci

echo "== typecheck and tests =="
npm run check
npm test

echo "== backing up remote D1 active data before migrations =="
D1_EXPORT_MODE=data D1_EXPORT_TABLES=active "${ROOT_DIR}/scripts/backup-d1.sh"

echo "== applying D1 migrations =="
retry_cloudflare "D1 migration" npm run d1:migrate:remote

echo "== setting Worker secrets =="
retry_cloudflare "ADMIN_TOKEN secret upload" bash -c 'printf "%s" "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN'
retry_cloudflare "AGENT_TOKEN secret upload" bash -c 'printf "%s" "$AGENT_TOKEN" | npx wrangler secret put AGENT_TOKEN'
retry_cloudflare "SUBSCRIPTION_TOKEN secret upload" bash -c 'printf "%s" "$SUBSCRIPTION_TOKEN" | npx wrangler secret put SUBSCRIPTION_TOKEN'

echo "== deploying Worker =="
retry_cloudflare "Worker deploy" npm run deploy

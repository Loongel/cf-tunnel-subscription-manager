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

WORKER_BASE_URL="${WORKER_BASE_URL:?set WORKER_BASE_URL}"
ADMIN_TOKEN="${ADMIN_TOKEN:?set ADMIN_TOKEN}"
AGENT_TOKEN="${AGENT_TOKEN:?set AGENT_TOKEN}"

AGENT_ID="${AGENT_ID:-smoke-agent}"
TUNNEL_KEY="${TUNNEL_KEY:-http_s1_2095}"
TARGET_URL="${TARGET_URL:-http://s1:2095}"
PUBLIC_URL="${PUBLIC_URL:-https://example.trycloudflare.com}"

api() {
  local method="$1"
  local path="$2"
  local token="$3"
  local body="${4:-}"
  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "${WORKER_BASE_URL}${path}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -fsS -X "$method" "${WORKER_BASE_URL}${path}" \
      -H "Authorization: Bearer ${token}"
  fi
  echo
}

safe_key() {
  local input="$1"
  local output=""
  local last_underscore=0
  local i char
  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"
    if [[ "$char" =~ [a-zA-Z0-9] ]]; then
      output+="$char"
      last_underscore=0
    elif [[ "$last_underscore" -eq 0 ]]; then
      output+="_"
      last_underscore=1
    fi
  done
  output="${output##_}"
  output="${output%%_}"
  printf '%s' "$output"
}

echo "== agent register =="
api POST /api/agent/register "$AGENT_TOKEN" "{
  \"agentId\":\"${AGENT_ID}\",
  \"instanceId\":\"smoke-instance\",
  \"hostname\":\"smoke-cloudflared\",
  \"swarmNodeName\":\"smoke-node\",
  \"stackName\":\"smoke-stack\",
  \"serviceName\":\"cloudflared\",
  \"imageVersion\":\"smoke\",
  \"cloudflaredVersion\":\"smoke\",
  \"capabilities\":{\"quickTunnel\":true,\"commandPolling\":true}
}"

echo "== agent heartbeat =="
api POST /api/agent/heartbeat "$AGENT_TOKEN" "{
  \"agentId\":\"${AGENT_ID}\",
  \"instanceId\":\"smoke-instance\",
  \"hostname\":\"smoke-cloudflared\",
  \"swarmNodeName\":\"smoke-node\",
  \"stackName\":\"smoke-stack\",
  \"serviceName\":\"cloudflared\",
  \"tunnels\":[{
    \"tunnelKey\":\"${TUNNEL_KEY}\",
    \"type\":\"quick\",
    \"targetUrl\":\"${TARGET_URL}\",
    \"publicUrl\":\"${PUBLIC_URL}\",
    \"publicHostname\":\"${PUBLIC_URL#https://}\",
    \"metricsPort\":2101,
    \"processStatus\":\"running\",
    \"healthStatus\":\"healthy\"
  }]
}"

echo "== admin overview =="
api GET /api/admin/overview "$ADMIN_TOKEN"

TUNNEL_ID="tun_$(safe_key "${AGENT_ID}_${TUNNEL_KEY}")"
echo "== create restart command for ${TUNNEL_ID} =="
api POST "/api/admin/tunnels/${TUNNEL_ID}/restart" "$ADMIN_TOKEN" '{}'

echo "== agent commands =="
api GET "/api/agent/commands?agentId=${AGENT_ID}&instanceId=smoke-instance" "$AGENT_TOKEN"

echo "== subscription preview =="
api GET "/api/admin/subscriptions/preview?format=v2ray" "$ADMIN_TOKEN"

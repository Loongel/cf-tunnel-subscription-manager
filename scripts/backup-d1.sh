#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_SECRET_FILE="${LOCAL_SECRET_FILE:-${ROOT_DIR}/.secrets/worker.env}"
BACKUP_DIR="${D1_BACKUP_DIR:-${ROOT_DIR}/.secrets/d1-backups}"
D1_DATABASE_NAME="${D1_DATABASE_NAME:-cf-tunnel-control-plane}"
D1_EXPORT_MODE="${D1_EXPORT_MODE:-full}"
D1_EXPORT_TABLES="${D1_EXPORT_TABLES:-}"
D1_EXPORT_TIMEOUT="${D1_EXPORT_TIMEOUT:-120s}"
D1_EXPORT_DOWNLOAD_TIMEOUT="${D1_EXPORT_DOWNLOAD_TIMEOUT:-120}"
D1_EXPORT_ATTEMPTS="${D1_EXPORT_ATTEMPTS:-3}"
ACTIVE_D1_TABLES="agents tunnels commands proxy_nodes preferred_endpoints preferred_endpoint_node_scopes proxy_node_endpoint_selections groups tunnel_events settings custom_snis proxy_node_sni_selections import_sources proxy_node_traffic_bindings proxy_node_mutable_state preferred_endpoint_node_exclusions"

if [[ -f "$LOCAL_SECRET_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$LOCAL_SECRET_FILE"
  set +a
fi

export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="${BACKUP_DIR}/${D1_DATABASE_NAME}-${timestamp}.sql"

cd "${ROOT_DIR}/worker"

args=(d1 export "$D1_DATABASE_NAME" --remote --output "$output" --skip-confirmation)

case "$D1_EXPORT_MODE" in
  full)
    ;;
  data)
    args+=(--no-schema)
    ;;
  schema)
    args+=(--no-data)
    ;;
  *)
    echo "D1_EXPORT_MODE must be one of: full, data, schema" >&2
    exit 1
    ;;
esac

if [[ "$D1_EXPORT_TABLES" == "active" ]]; then
  table_list="$ACTIVE_D1_TABLES"
else
  table_list="$D1_EXPORT_TABLES"
fi

if [[ -n "$table_list" ]]; then
  read -r -a tables <<< "${table_list//,/ }"
  for table in "${tables[@]}"; do
    [[ -n "$table" ]] && args+=(--table "$table")
  done
fi

echo "== exporting remote D1 ${D1_DATABASE_NAME} (${D1_EXPORT_MODE}) =="
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

sanitize_log() {
  tr -d '\r' < "$1" \
    | sed -E 's/\x1B\[[0-9;?]*[A-Za-z]//g; s#https://[^[:space:]]+#<temporary-export-url>#g' \
    | grep -Ev 'Creating export|Script started|Script done' \
    | tail -n 80
}

success=0
for ((attempt = 1; attempt <= D1_EXPORT_ATTEMPTS; attempt++)); do
  log_file="${tmp_dir}/attempt-${attempt}.log"
  run_status=0
  if [[ "$D1_EXPORT_ATTEMPTS" -gt 1 ]]; then
    echo "D1 export attempt ${attempt}/${D1_EXPORT_ATTEMPTS}"
  fi

  if command -v script >/dev/null 2>&1; then
    printf -v wrangler_command "%q " npx wrangler "${args[@]}"
    if command -v timeout >/dev/null 2>&1; then
      timeout --foreground "$D1_EXPORT_TIMEOUT" script -q -e -c "$wrangler_command" "$log_file" >/dev/null 2>&1 || run_status=$?
    else
      script -q -e -c "$wrangler_command" "$log_file" >/dev/null 2>&1 || run_status=$?
    fi
  else
    if command -v timeout >/dev/null 2>&1; then
      timeout "$D1_EXPORT_TIMEOUT" npx wrangler "${args[@]}" >"$log_file" 2>&1 || run_status=$?
    else
      npx wrangler "${args[@]}" >"$log_file" 2>&1 || run_status=$?
    fi
  fi

  if [[ "$run_status" -eq 0 ]]; then
    success=1
    break
  fi

  export_url="$(
    tr -d '\r' < "$log_file" \
      | sed -E 's/\x1B\[[0-9;?]*[A-Za-z]//g' \
      | grep -Eo 'https://[^[:space:]]+\.sql\?[^[:space:]]+' \
      | head -n 1 \
      || true
  )"
  if [[ -n "$export_url" ]] && command -v curl >/dev/null 2>&1; then
    echo "Wrangler export download failed; retrying the generated export with curl."
    if curl --fail --location --silent --show-error --connect-timeout 15 --max-time "$D1_EXPORT_DOWNLOAD_TIMEOUT" "$export_url" --output "$output"; then
      success=1
      break
    fi
  fi

  if [[ "$attempt" -lt "$D1_EXPORT_ATTEMPTS" ]]; then
    echo "D1 export attempt ${attempt} failed; retrying."
    sleep $((attempt * 2))
  else
    echo "Wrangler export failed and no generated export could be downloaded." >&2
    sanitize_log "$log_file" >&2
  fi
done

if [[ "$success" -ne 1 ]]; then
  exit 1
fi

echo "D1 backup written to ${output}"

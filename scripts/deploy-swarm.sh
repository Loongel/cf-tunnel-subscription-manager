#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SWARM_ENV_FILE="${SWARM_ENV_FILE:-${ROOT_DIR}/.secrets/swarm.env}"

if [[ ! -f "$SWARM_ENV_FILE" ]]; then
  echo "missing swarm env file: ${SWARM_ENV_FILE}" >&2
  echo "create it with: cp deploy/.env.template .secrets/swarm.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SWARM_ENV_FILE"
set +a

: "${STACK_NAME:?set STACK_NAME in ${SWARM_ENV_FILE}}"
: "${DEPLOY_NODE:?set DEPLOY_NODE in ${SWARM_ENV_FILE}}"
: "${WORKER_BASE_URL:?set WORKER_BASE_URL in ${SWARM_ENV_FILE}}"
: "${AGENT_TOKEN:?set AGENT_TOKEN in ${SWARM_ENV_FILE}}"

docker stack deploy --with-registry-auth -c "${ROOT_DIR}/deploy/docker-stack.example.yml" "${STACK_NAME}"

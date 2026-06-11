#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-hd01}"
REMOTE_DIR="${REMOTE_DIR:-/root/builds/cf-tunnel-subscription-manager}"
IMAGE_TAG="${IMAGE_TAG:-cf-tunnel-agent:test}"

ssh "${REMOTE}" "mkdir -p '${REMOTE_DIR}'"

if ! rsync -az --delete \
  --exclude node_modules \
  --exclude .wrangler \
  --exclude .git \
  ./ "${REMOTE}:${REMOTE_DIR}/"; then
  echo "rsync failed; falling back to tar over ssh" >&2
  ssh "${REMOTE}" "rm -rf '${REMOTE_DIR}' && mkdir -p '${REMOTE_DIR}'"
  tar \
    --exclude node_modules \
    --exclude .wrangler \
    --exclude .git \
    -czf - . | ssh "${REMOTE}" "cd '${REMOTE_DIR}' && tar -xzf -"
fi

ssh "${REMOTE}" "set -euo pipefail
  cd '${REMOTE_DIR}/worker'
  npm ci
  npm run check
  npm test
  cd '${REMOTE_DIR}/agent'
  go test ./...
  docker build --build-arg CLOUDFLARED_VERSION=2026.6.0 -t '${IMAGE_TAG}' .
"

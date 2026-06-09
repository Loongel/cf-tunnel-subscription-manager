# Project Status

Last updated: 2026-06-10

## Completed Source Work

- Worker control plane:
  - Agent register/heartbeat/event/command APIs.
  - Admin overview, tunnel restart, proxy node, endpoint, group, event APIs.
  - D1 migration schema.
  - Scheduled HTTP/HTTPS tunnel health probe and restart command queue.
  - Expired command cleanup during scheduled runs.
  - V2Ray, PassWall2, and sing-box subscription endpoints.
  - D1-backed subscription token rotation.
  - Group-level endpoint mode defaults for subscription generation.
  - Worker-served admin UI.
- Go tunnel agent:
  - Environment parsing and target normalization.
  - Fixed tunnel supervision.
  - Multiple quick tunnel supervision with independent metrics ports.
  - TryCloudflare URL parsing and local `tunnels.list` compatibility.
  - Worker registration, heartbeat, event reporting, command polling, restart handling.
  - Container health endpoint.
- Docker and deployment templates:
  - Agent Dockerfile with pinned `cloudflared 2026.6.0`.
  - Docker Swarm stack example.
  - Worker Wrangler config and D1 migration.
  - Remote build script for `ssh hd01`.
  - Worker deploy helper using runtime environment variables for secrets.

## Verified

Executed on `ssh hd01` with `SSH_AUTH_SOCK=/tmp/ssh-hPdP3ZA6Jo6o/agent.14261`:

- `./scripts/remote-build-hd01.sh`
- Worker `npm ci`
- Worker `npm run check`
- Worker `npm test` (`4` tests passed)
- Agent `go test ./...`
- Agent Docker image build with `cloudflared 2026.6.0`
- Worker `npm run d1:migrate:local` (`0001_initial.sql`, `19` commands)
- Worker `npx wrangler deploy --dry-run`

Additional checks:

- `bash -n scripts/*.sh`
- `git diff --check`
- Secret scan found no committed Cloudflare API token, tunnel token, or subscription/admin token.

## Current Blocker

Live Cloudflare deployment is blocked by API token permissions. Both available tokens reached the account but returned Cloudflare API authentication error `10000` for `/accounts/<account_id>/d1/database`.

Required token permissions:

- D1 database read/write or edit.
- Workers script edit/deploy.
- Worker secret edit.

After a suitable token is available:

```bash
SSH_AUTH_SOCK=/tmp/ssh-hPdP3ZA6Jo6o/agent.14261 ./scripts/deploy-worker.sh
WORKER_BASE_URL=https://your-worker.example \
ADMIN_TOKEN=... \
AGENT_TOKEN=... \
./scripts/worker-smoke.sh
```

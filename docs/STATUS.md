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
- Remote D1 database `cf-tunnel-control-plane` created with ID `c018bec2-7abd-42b8-863d-3030727f0026`
- Remote D1 migration applied successfully
- Worker deployed to `https://cf-tunnel-control-plane.officesline.workers.dev`
- Worker smoke test passed for agent register, heartbeat, restart command creation, command polling, and subscription preview
- Smoke-test rows were removed from remote D1 after verification

Additional checks:

- `bash -n scripts/*.sh`
- `git diff --check`
- Secret scan found no committed Cloudflare API token, tunnel token, or subscription/admin token.

## Runtime Secrets

Generated runtime secrets were stored only on `hd01` at:

`/root/.cf-tunnel-control-plane.secrets`

The file is not in the repository and contains `ADMIN_TOKEN`, `AGENT_TOKEN`, and `SUBSCRIPTION_TOKEN`.

## Remaining Work

- Push a production agent image to the target container registry.
- Deploy `deploy/docker-stack.example.yml` or a derived stack with the generated `AGENT_TOKEN` and Worker URL.
- Verify a real Swarm quick tunnel heartbeat and restart command path from an agent container.

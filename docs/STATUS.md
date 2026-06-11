# Cloudflare Tunnel Subscription Manager Status

Last updated: 2026-06-11

Repository slug: `cf-tunnel-subscription-manager`.

Production Worker resource name remains `cf-tunnel-control-plane` to preserve the existing deployment URL and D1 binding.

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
  - Subscription import-source management, fallback/TLS-carrier composition, and refresh semantics that replace stale imported nodes only after successful non-empty fetches.
  - Node-scoped endpoint selections are preserved across import-source refreshes.
- Go tunnel agent:
  - Environment parsing and target normalization.
  - Fixed tunnel supervision.
  - Multiple quick tunnel supervision with independent metrics ports.
  - TryCloudflare URL parsing and local `tunnels.list` compatibility.
  - Worker registration, heartbeat, event reporting, command polling, restart handling.
  - Request-conservative defaults: heartbeat and command polling default to 120 seconds, with short 5 second follow-up polling only after commands are received.
  - Container health endpoint.
- Docker and deployment templates:
  - Agent Dockerfile with pinned `cloudflared 2026.6.0`.
  - GitHub Actions workflow for publishing the agent image to GHCR on version tags.
  - Docker Swarm stack example.
  - Worker Wrangler config and D1 migration.
  - Remote build script for `ssh hd01`.
  - Worker deploy helper using runtime environment variables for secrets.
  - Repository-local `.secrets/worker.env` and `.secrets/swarm.env` workflow for repeatable local deployment without committing secrets.

## Verified

Executed on `ssh hd01` with `SSH_AUTH_SOCK=/tmp/ssh-hPdP3ZA6Jo6o/agent.14261`:

- `./scripts/remote-build-hd01.sh`
- Worker `npm ci`
- Worker `npm run check`
- Worker `npm test` (`16` tests passed)
- Agent `go test ./...`
- Agent Docker image build with `cloudflared 2026.6.0`
- Production agent image configured as `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.4`
- Worker `npm run d1:migrate:local` (`0001_initial.sql`, `19` commands)
- Worker `npx wrangler deploy --dry-run`
- Remote D1 database `cf-tunnel-control-plane` created with ID `c018bec2-7abd-42b8-863d-3030727f0026`
- Remote D1 migration applied successfully
- Worker deployed to `https://cf-tunnel-control-plane.officesline.workers.dev`
- Worker smoke test passed for agent register, heartbeat, restart command creation, command polling, and subscription preview
- Smoke-test rows were removed from remote D1 after verification
- Real Agent container test passed on `hd01` with a temporary nginx target, quick tunnel URL capture, Worker heartbeat, restart command ack, new URL capture, and public HTTP `200`
- Docker Swarm stack test passed on `hd01` with a temporary overlay network, nginx target service, Agent service, `EDGE_IP_VERSION=auto`, quick tunnel URL capture, and public HTTP `200`
- Swarm restart command test passed: Worker queued `restart_tunnel`, Agent acked it, wrote a new quick tunnel URL, and the new URL returned HTTP `200` using Cloudflare DNS resolution
- Temporary runtime test containers, Swarm stacks, volumes, and D1 rows were removed after verification
- Admin UI browser test passed with Playwright on `hd01`: wrong token feedback, correct login, endpoint creation, proxy node creation, and subscription preview generation
- Admin UI Chromium smoke passed on 2026-06-11 after layout cleanup: authenticated page no longer shows stale public-status notice, Proxy Nodes endpoint counts reflect loaded global endpoints, and Saved Groups chips render compactly.
- Endpoint-binding regression test passed: refreshing imported nodes preserves node-scoped endpoint selections for future refreshes.
- Worker deployed version `020883a3-fb90-4e2d-89ec-b1e99f5510b3`
- Public agent image `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.4` was published by GitHub Actions, anonymously pulled, and verified to report `cloudflared version 2026.6.0`
- Agent image digest: `sha256:ed88e369233ad841d4a17d1a3483e07f45161b1594593add7bab091ede06515b`
- A demo Swarm stack `cftunneldemo` is intentionally left running on `hd01` for manual UI validation; see `docs/USER_VALIDATION.md`

Additional checks:

- `bash -n scripts/*.sh`
- `git diff --check`
- Secret scan found no committed Cloudflare API token, tunnel token, or subscription/admin token.

## Runtime Secrets

Generated runtime secrets were stored only on `hd01` at:

`/root/.cf-tunnel-control-plane.secrets`

The file is not in the repository and contains `ADMIN_TOKEN`, `AGENT_TOKEN`, and `SUBSCRIPTION_TOKEN`.

## Remaining Work

- Deploy the production Swarm stack with real service targets and, if needed, a fixed `TUNNEL_TOKEN`.
- Keep the old Worker and D1 data until the new deployment is verified and critical data has been migrated.
- Evaluate a low-request state channel for agent/tunnel liveness:
  - Goal: reduce Worker request volume by moving frequent agent liveness writes and tunnel probes out of Worker request endpoints.
  - Preferred shape: agent probes tunnels locally and writes compact lease/status records to an external low-cost state channel such as Redis/Valkey/Upstash with TTL; Worker reads that state on demand for admin UI/subscription generation and uses low-frequency cron only as a fallback.
  - Cloudflare KV can be evaluated for coarse status/cache data, but its eventual consistency and direct-write credential requirements make it a weaker fit for real-time liveness and command delivery.
  - Do not design this as a Worker process polling every 10 seconds; Workers are request/event driven, and sub-minute continuous polling is not a good fit. Use TTL leases, read-on-demand, and event/change-driven updates instead.
  - Keep D1 as the source of truth for configuration, bindings, groups, commands, and audit history; the external state channel should hold ephemeral status only.

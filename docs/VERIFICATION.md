# Cloudflare Tunnel Subscription Manager Verification

## Worker

Run on `ssh hd01`:

```bash
cd worker
npm ci
npm run check
npm test
npx wrangler d1 migrations apply cf-tunnel-control-plane --local
npx wrangler deploy --dry-run
```

## Agent

Run on `ssh hd01`:

```bash
cd agent
go test ./...
docker build --build-arg CLOUDFLARED_VERSION=2026.6.0 -t cf-tunnel-agent:test .
```

After a version tag is pushed, verify the published image:

```bash
docker pull ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.2
docker run --rm ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.2 cloudflared --version
```

## Smoke Checks

- `POST /api/agent/register` accepts `AGENT_TOKEN`.
- `POST /api/agent/heartbeat` upserts quick tunnel status.
- `POST /api/admin/tunnels/:id/restart` creates a command.
- `GET /api/agent/commands` returns the pending command.
- `GET /sub/v2ray/:token`, `/sub/passwall2/:token`, and `/sub/sing-box/:token` return generated subscriptions.
- Worker cron marks failed HTTP/HTTPS quick tunnels degraded/unhealthy and queues restart after the failure threshold.

After deployment, the API smoke script can exercise the main control-plane flow:

```bash
WORKER_BASE_URL=https://your-worker.example \
ADMIN_TOKEN=... \
AGENT_TOKEN=... \
./scripts/worker-smoke.sh
```

## Verified On 2026-06-11

Executed on `ssh hd01`:

- `SSH_AUTH_SOCK=/tmp/ssh-hPdP3ZA6Jo6o/agent.14261 ./scripts/remote-build-hd01.sh`
- Worker `npm ci`
- Worker `npm run check`
- Worker `npm test` (`15` Vitest tests passed)
- Agent `go test ./...`
- Agent Docker build with `cloudflared 2026.6.0`
- Agent image release workflow configured for GHCR image `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.2`
- `npm run d1:migrate:local` (`0001_initial.sql`, `19` commands)
- `npx wrangler deploy --dry-run`
- `npx wrangler d1 create cf-tunnel-control-plane`
- `npm run d1:migrate:remote`
- `npm run deploy`
- `./scripts/worker-smoke.sh`
- Real Agent container test on `hd01`: quick tunnel URL capture, public HTTP `200`, Worker heartbeat, restart command ack, and new URL capture
- Temporary Docker Swarm stack test on `hd01`: nginx target service, Agent service, overlay network, `EDGE_IP_VERSION=auto`, public HTTP `200`, restart command ack, and new URL public HTTP `200`
- Playwright admin UI test on `hd01`: wrong token shows error, correct token logs in, dashboard metrics load, endpoint/node forms submit, and V2Ray preview returns `generatedCount = 1`
- Chromium admin UI smoke on 2026-06-11: authenticated page renders without the stale public-status notice, Proxy Nodes endpoint counts load after endpoint state, and group chips render compactly.
- Endpoint binding regression test on 2026-06-11: replacing imported nodes preserves node-scoped endpoint selections for future refreshes.

Deployment URL: `https://cf-tunnel-control-plane.officesline.workers.dev`

Latest verified Worker version: `020883a3-fb90-4e2d-89ec-b1e99f5510b3`.

Smoke-test and runtime-test rows were removed from remote D1 after verification.

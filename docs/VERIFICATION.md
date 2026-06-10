# Verification Plan

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

## Verified On 2026-06-10

Executed on `ssh hd01`:

- `npm ci`
- `npm run check`
- `npm test` (`4` Vitest tests passed)
- `go test ./...`
- `docker build --build-arg CLOUDFLARED_VERSION=2026.6.0 -t cf-tunnel-agent:test .`
- `npm run d1:migrate:local` (`0001_initial.sql`, `19` commands)
- `npx wrangler deploy --dry-run`
- `npx wrangler d1 create cf-tunnel-control-plane`
- `npm run d1:migrate:remote`
- `npm run deploy`
- `./scripts/worker-smoke.sh`
- Real Agent container test on `hd01`: quick tunnel URL capture, public HTTP `200`, Worker heartbeat, restart command ack, and new URL capture
- Temporary Docker Swarm stack test on `hd01`: nginx target service, Agent service, overlay network, `EDGE_IP_VERSION=auto`, public HTTP `200`, restart command ack, and new URL public HTTP `200`

Deployment URL: `https://cf-tunnel-control-plane.officesline.workers.dev`

Smoke-test and runtime-test rows were removed from remote D1 after verification.

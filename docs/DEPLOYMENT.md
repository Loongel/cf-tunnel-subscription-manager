# Cloudflare Tunnel Subscription Manager Deployment Guide

This guide is written for a fresh operator deploying the project without reading the source code. It uses placeholders and must not contain real Cloudflare tokens.

Existing deployments should keep the old Worker and data until the new Worker, D1 data, and agent image are verified.

## Release Artifacts

| Artifact | Value |
| --- | --- |
| Repository | `https://github.com/Loongel/cf-tunnel-subscription-manager` |
| Worker script name | `cf-tunnel-control-plane` |
| Worker URL currently used by this deployment | `https://cf-tunnel-control-plane.officesline.workers.dev` |
| D1 database name currently used by this deployment | `cf-tunnel-control-plane` |
| Agent image | `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.2` |
| Agent image fallback for local testing | `cf-tunnel-agent:test` |
| Pinned cloudflared version | `2026.6.0` |

The Worker/D1 resource names remain `cf-tunnel-control-plane` to preserve the existing deployment URL and database binding. The project and repository name is `cf-tunnel-subscription-manager`.

## Deployment Order

1. Deploy or update the Worker and D1 database.
2. Verify Worker login, public metrics, proxy-node editing, import refresh, and subscription preview.
3. Publish or select the agent image tag.
4. Deploy the Swarm stack with the versioned agent image.
5. Verify agent registration, heartbeat, quick tunnel URL capture, restart commands, and subscription output.
6. Migrate any critical data from the old Worker if this is a replacement deployment.
7. Switch traffic or DNS only after the new deployment is stable.
8. Remove the old Worker and temporary validation data only after the cutover is complete.

## Worker Deployment

Install dependencies from `worker/`:

```bash
cd worker
npm ci
```

Create D1 once per environment:

```bash
npx wrangler d1 create cf-tunnel-control-plane
```

Update [worker/wrangler.toml](../worker/wrangler.toml) with the returned D1 `database_id`.

Set Worker secrets:

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put AGENT_TOKEN
npx wrangler secret put SUBSCRIPTION_TOKEN
```

Secret meanings:

| Secret | Required | Used by | Meaning |
| --- | --- | --- | --- |
| `ADMIN_TOKEN` | yes | Browser/admin API | Bearer token for management UI and admin endpoints. |
| `AGENT_TOKEN` | yes | Agent containers | Bearer token used by agents to register, heartbeat, post events, poll commands, and acknowledge commands. |
| `SUBSCRIPTION_TOKEN` | yes | Subscription clients | Initial token embedded in `/sub/.../:token` URLs. The admin UI can rotate and persist the active token in D1. |

Apply migrations and deploy:

```bash
npx wrangler d1 migrations apply cf-tunnel-control-plane --remote
npx wrangler deploy
```

The helper script runs dependency install, typecheck, tests, remote D1 migrations, Worker secret upload, and deploy:

```bash
CLOUDFLARE_API_TOKEN=... \
CLOUDFLARE_ACCOUNT_ID=... \
ADMIN_TOKEN=... \
AGENT_TOKEN=... \
SUBSCRIPTION_TOKEN=... \
./scripts/deploy-worker.sh
```

`CLOUDFLARE_API_TOKEN` must be able to manage D1, deploy Workers, and edit Worker secrets. A token that can only identify the account is not enough.

## Agent Image

The default production image is:

```text
ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.2
```

The image is built from [agent/Dockerfile](../agent/Dockerfile), includes the Go tunnel agent and pinned `cloudflared 2026.6.0`, and does not download `cloudflared` at runtime.

For local testing on a single node:

```bash
cd agent
docker build --build-arg CLOUDFLARED_VERSION=2026.6.0 -t cf-tunnel-agent:test .
```

For production Swarm, use the published GHCR image or publish your own registry image. Multi-node Swarm deployments must use an image that every target node can pull.

## Docker Swarm Deployment

Copy [deploy/.env.template](../deploy/.env.template) to a private env file and fill in the values:

```bash
cp deploy/.env.template .env.production
```

Deploy:

```bash
set -a
. ./.env.production
set +a
docker stack deploy --with-registry-auth -c deploy/docker-stack.example.yml "${STACK_NAME}"
```

The stack template expects the external Docker networks `aa_host_bridge` and `cf-net` to already exist. Create or rename networks to match your environment before deploying.

The agent health endpoint is `http://127.0.0.1:1984/health` inside the container. Quick tunnel mappings are also written to the mounted volume at `/temp-tunnel/tunnels.list`.

## Stack Configuration Reference

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `DOMAIN` | no | `example.com` in template | Operator-owned domain marker. The current stack template does not use it directly, but it is kept for environment consistency with existing stacks. |
| `DEPLOY_NODE` | yes | none | Docker Swarm node hostname where the agent service must run. Used by the placement constraint and as `SWARM_NODE_NAME`. |
| `STACK_NAME` | yes | `edge` in examples | Swarm stack name and agent metadata value. |
| `AGENT_IMAGE` | yes | `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.2` | Agent container image. Pin a version tag for production. |
| `TUNNEL_TOKEN` | no | empty | Cloudflare fixed tunnel token. Leave empty to run only quick tunnels. |
| `QUICK_TUNNELS` | no if `TUNNEL_TOKEN` is set | empty | Space- or comma-separated quick tunnel targets, for example `http://s1:2095 http://s2:2096`. Each target starts an independent TryCloudflare tunnel. |
| `EDGE_IP_VERSION` | no | `auto` in template | Passed to `cloudflared --edge-ip-version`. Use `auto` for Swarm overlay networks unless container IPv6 is verified. Valid values are `auto`, `4`, and `6`. |
| `WORKER_BASE_URL` | yes | none | Base URL of the Worker control plane, without trailing slash. |
| `AGENT_TOKEN` | yes | none | Must match the Worker `AGENT_TOKEN` secret. |
| `FIXED_METRICS_PORT_BASE` | no | `2000` | Metrics port for the fixed tunnel process. |
| `QUICK_METRICS_PORT_BASE` | no | `2100` | Base metrics port for quick tunnels. The first quick tunnel uses base plus one. |
| `HEARTBEAT_INTERVAL` | no | `30s` | How often the agent posts status to the Worker. Accepts Go duration strings or seconds. |
| `COMMAND_POLL_INTERVAL` | no | `20s` | How often the agent polls the Worker for restart/status commands. Accepts Go duration strings or seconds. |
| `RESTART_COOLDOWN_SECONDS` | no | `610` | Minimum cooldown before a quick tunnel restarts after failure, used to avoid TryCloudflare rate limiting. Accepts Go duration strings or seconds. |
| `QUICK_START_SPACING` | no | `20s` | Delay between starting quick tunnel processes. Reduces startup bursts and rate-limit risk. |

## Worker Runtime Configuration

| Binding or variable | Required | Meaning |
| --- | --- | --- |
| `DB` | yes | D1 binding storing agents, tunnels, events, proxy nodes, endpoints, groups, settings, import sources, and commands. |
| `PUBLIC_BASE_URL` | no | Absolute public base URL used when generating subscription links in the admin UI. Empty means the browser origin is used. |
| `SUBCONVERTER_URL` | no | Reserved extension point for a future external converter. The first release keeps conversion local. |

## Post-Deploy Verification

Run the remote build and API smoke from the repository root:

```bash
SSH_AUTH_SOCK=/tmp/ssh-hPdP3ZA6Jo6o/agent.14261 ./scripts/remote-build-hd01.sh

WORKER_BASE_URL=https://cf-tunnel-control-plane.officesline.workers.dev \
ADMIN_TOKEN=... \
AGENT_TOKEN=... \
./scripts/worker-smoke.sh
```

Manual checks:

1. Open `/admin` without a token and confirm public metric cards load.
2. Log in with `ADMIN_TOKEN`.
3. Confirm tunnels, proxy nodes, endpoints, groups, and subscription links load.
4. Confirm the Swarm agent appears online and reports a quick tunnel public URL.
5. Queue a quick tunnel restart from the UI and confirm the agent acknowledges it.
6. Import a subscription source and confirm refresh does not clear previous successful data after a failed fetch.
7. Confirm `/sub/v2ray/:token`, `/sub/passwall2/:token`, and `/sub/sing-box/:token` return non-empty outputs for configured nodes.

## Data Migration Notes

For a Worker replacement, migrate D1 data before switching traffic. Critical tables normally include agents, tunnels, proxy nodes, preferred endpoints, custom SNI values, import sources, groups, settings, and selection tables.

Do not delete the old Worker or old D1 database until:

- The new Worker admin UI is reachable.
- The new agent image is deployed and agents are online.
- Subscription URLs return expected nodes.
- Important node-specific endpoint bindings and group memberships have been checked.
- At least one scheduled cron cycle has completed without unexpected restart commands.

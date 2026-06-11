# Cloudflare Tunnel Subscription Manager Deployment Guide

This guide is written for a fresh operator deploying the project without reading the source code. It uses placeholders and must not contain real Cloudflare tokens.

Existing deployments should keep the old Worker and data until the new Worker, D1 data, and agent image are verified.

## Local Secret Files

Deployment secrets are intentionally not committed to Git, but operators should keep them in a stable local location so deployments are repeatable.

Use this repository-local layout:

```text
.secrets/
  worker.env
  swarm.env
```

Create the files from committed templates:

```bash
install -m 700 -d .secrets
cp deploy/worker.env.template .secrets/worker.env
cp deploy/.env.template .secrets/swarm.env
chmod 600 .secrets/*.env
```

The `.secrets/` directory is excluded by `.gitignore` and by the remote build script. Do not put `.secrets/` into Docker images or release artifacts.

File purposes:

| File | Used by | Contains |
| --- | --- | --- |
| `.secrets/worker.env` | `scripts/deploy-worker.sh`, `scripts/worker-smoke.sh` | Cloudflare API token, account ID, Worker URL, `ADMIN_TOKEN`, `AGENT_TOKEN`, and `SUBSCRIPTION_TOKEN`. |
| `.secrets/swarm.env` | `scripts/deploy-swarm.sh` | Swarm stack variables, agent image tag, tunnel token, quick tunnel targets, Worker URL, and `AGENT_TOKEN`. |

`hd01` currently also keeps generated runtime secrets at `/root/.cf-tunnel-control-plane.secrets` for the deployed Worker validation environment. Treat that file as host-local operational state, not as source code.

## Release Artifacts

| Artifact | Value |
| --- | --- |
| Repository | `https://github.com/Loongel/cf-tunnel-subscription-manager` |
| Worker script name | `cf-tunnel-control-plane` |
| Worker URL currently used by this deployment | `https://cf-tunnel-control-plane.officesline.workers.dev` |
| D1 database name currently used by this deployment | `cf-tunnel-control-plane` |
| Agent image | `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.3` |
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

The helper script reads `.secrets/worker.env` by default, then runs dependency install, typecheck, tests, remote D1 migrations, Worker secret upload, and deploy:

```bash
./scripts/deploy-worker.sh
```

To use a different local secret file:

```bash
LOCAL_SECRET_FILE=/secure/path/worker.env ./scripts/deploy-worker.sh
```

`CLOUDFLARE_API_TOKEN` must be able to manage D1, deploy Workers, and edit Worker secrets. A token that can only identify the account is not enough.

## Agent Image

The default production image is:

```text
ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.3
```

The image is built from [agent/Dockerfile](../agent/Dockerfile), includes the Go tunnel agent and pinned `cloudflared 2026.6.0`, and does not download `cloudflared` at runtime.

Verify the published image before using it in a production stack:

```bash
docker pull ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.3
docker run --rm --entrypoint cloudflared ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.3 --version
```

For local testing on a single node:

```bash
cd agent
docker build --build-arg CLOUDFLARED_VERSION=2026.6.0 -t cf-tunnel-agent:test .
```

For production Swarm, use the published GHCR image or publish your own registry image. Multi-node Swarm deployments must use an image that every target node can pull.

## Docker Swarm Deployment

Copy [deploy/.env.template](../deploy/.env.template) to the local Swarm secret file and fill in the values:

```bash
cp deploy/.env.template .secrets/swarm.env
chmod 600 .secrets/swarm.env
```

Deploy:

```bash
./scripts/deploy-swarm.sh
```

To use a different file, set `SWARM_ENV_FILE=/secure/path/swarm.env`.

The stack template expects the external Docker networks `aa_host_bridge` and `cf-net` to already exist. Create or rename networks to match your environment before deploying.

The agent health endpoint is `http://127.0.0.1:1984/health` inside the container. Quick tunnel mappings are also written to the mounted volume at `/temp-tunnel/tunnels.list`.

## Stack Configuration Reference

These variables are intended to be set by the operator in the private env file used with `docker stack deploy`.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `DOMAIN` | no | `example.com` in template | Operator-owned domain marker. The current stack template does not use it directly, but it is kept for environment consistency with existing stacks. |
| `DEPLOY_NODE` | yes | none | Docker Swarm node hostname where the agent service must run. Used by the placement constraint and as `SWARM_NODE_NAME`. |
| `STACK_NAME` | yes | `edge` in examples | Swarm stack name and agent metadata value. |
| `AGENT_IMAGE` | yes | `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.3` | Agent container image. Pin a version tag for production. |
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

The stack template also injects these container variables. Most operators should leave them as the template defines them.

| Variable | Source | Default in template | Meaning |
| --- | --- | --- | --- |
| `LOG_FILE` | fixed template value | `/temp-tunnel/history.log` | Local append-only quick tunnel history file in the mounted volume. |
| `MAP_FILE` | fixed template value | `/temp-tunnel/tunnels.list` | Local compatibility file containing `target public-url` mappings for active quick tunnels. |
| `SWARM_NODE_NAME` | derived from `DEPLOY_NODE` | `${DEPLOY_NODE}` | Node identity reported to the Worker and used when deriving the agent ID. |
| `STACK_NAME` | operator variable | `${STACK_NAME}` | Stack identity reported to the Worker. |
| `SERVICE_NAME` | fixed template value | `cloudflared` | Service identity reported to the Worker. Change only if you rename the service and want matching metadata. |
| `IMAGE_VERSION` | derived from `AGENT_IMAGE` | `${AGENT_IMAGE}` | Image metadata reported to the Worker for audit and troubleshooting. |

Advanced agent variables are supported by the binary but are not normally needed in the Swarm template.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_ID` | derived from swarm node, stack, service, and hostname | Stable ID used by the Worker. Set only when you need to preserve identity across hostname or stack-name changes. |
| `CLOUDFLARED_PATH` | `/usr/local/bin/cloudflared` | Path to the bundled `cloudflared` binary. Override only for custom images. |
| `HEALTH_ADDR` | `127.0.0.1:1984` | Agent health HTTP listener used by the container healthcheck. |

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

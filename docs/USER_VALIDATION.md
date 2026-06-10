# User Validation Guide

Last updated: 2026-06-10

## Admin UI

URL:

```text
https://cf-tunnel-control-plane.officesline.workers.dev/admin
```

The admin token is stored on `hd01` only and is not committed to Git:

```bash
ssh hd01 "awk -F= '/^ADMIN_TOKEN=/{print \$2}' /root/.cf-tunnel-control-plane.secrets"
```

If the dashboard shows all zeros, it means no Agent is currently reporting. The Worker does not discover tunnels by itself; the Agent must be running and sending heartbeats.

## Current Demo Stack

A demo Docker Swarm stack is currently running on `hd01` so the UI has real data to inspect:

```text
stack: cftunneldemo
target service: cftunneldemo_target
agent service: cftunneldemo_cloudflared
agent id: demo-hd01
target: http://target:80
```

Check it from `hd01`:

```bash
docker stack services cftunneldemo
docker service ps cftunneldemo_cloudflared
cid=$(docker ps -q --filter label=com.docker.swarm.service.name=cftunneldemo_cloudflared | head -n1)
docker exec "$cid" cat /temp-tunnel/tunnels.list
```

The current UI demo configuration was created through browser automation:

```text
preferred endpoint: demo-cf-ip = 104.16.0.1
proxy node: demo-vless-ui
subscription preview: generatedCount = 1, protocol vless = 1
```

## Browser Flow Verified

The UI was tested with Playwright on `hd01`:

- Wrong admin token shows a visible login failure.
- Correct admin token logs in and loads dashboard metrics.
- Dashboard showed `1` online agent and `1` healthy tunnel with the demo stack running.
- Preferred endpoint creation works.
- Proxy node creation works.
- Subscription preview generated one VLESS node.
- Subscription links render in the Subscriptions tab.

## Cleanup

Remove the demo stack after inspection:

```bash
ssh hd01 "docker stack rm cftunneldemo"
```

Remove demo UI config rows if desired:

```bash
ssh hd01 '
cd /root/builds/CF-temp-tunnels-auto-update-to-subs/worker
export CLOUDFLARE_ACCOUNT_ID=9e0d7a7708a7cdbf66f1298514aefebb
export CLOUDFLARE_API_TOKEN=<token with D1 access>
npx wrangler d1 execute cf-tunnel-control-plane --remote --command "
DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE name LIKE '\''demo-%'\'');
DELETE FROM groups WHERE name LIKE '\''demo-%'\'';
DELETE FROM proxy_node_endpoint_selections WHERE proxy_node_id IN (SELECT id FROM proxy_nodes WHERE name LIKE '\''demo-%'\'');
DELETE FROM proxy_nodes WHERE name LIKE '\''demo-%'\'';
DELETE FROM preferred_endpoint_node_scopes WHERE endpoint_id IN (SELECT id FROM preferred_endpoints WHERE label LIKE '\''demo-%'\'');
DELETE FROM preferred_endpoints WHERE label LIKE '\''demo-%'\'';
"
'
```


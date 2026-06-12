# Cloudflare Tunnel Subscription Manager User Validation Guide

Last updated: 2026-06-11

## Admin UI

URL:

```text
https://cf-tunnel-control-plane.officesline.workers.dev/admin
```

The admin token is stored in local operational secret files and is not committed to Git. Use the local file when validating the UI:

```bash
awk -F= '/^ADMIN_TOKEN=/{print "ADMIN_TOKEN=<set>"}' .secrets/worker.env
```

The dashboard metric cards are public. Before login they should still show aggregate counts from `/api/public/overview`. Login is required for event details, tunnel actions, proxy node management, endpoint management, and subscription URLs.

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

## Manual UI Checks

1. Open `/admin` with no token. The four dashboard metric cards should load real counts instead of resetting to zero.
2. Enter a wrong token and click `Login`. The notice bar should show a visible login failure.
3. Enter the admin token and click `Login`. Events, tunnels, nodes, endpoints, groups, and subscription links should load.
4. In `Proxy Nodes`, add or edit a node only in `Node Sources`; tunnel and endpoint choices should not appear in that form.
5. In `Proxy Nodes`, click a node table row to load that node into both `Node Sources` and `Traffic Binding`. `Tunnel / SNI` is multi-select, so one node can generate derived entries for multiple tunnel SNI values.
6. In `Preferred Endpoints`, paste IPs/domains separated by commas, spaces, or newlines into `Values`; one click should create multiple endpoint rows. `Global Always On` endpoints are automatically used by every tunnel-backed node. `Binding Option` endpoints are selected from `Traffic Binding`.
7. In `Proxy Nodes`, use `Import From Subscription` with either subscription URLs or pasted subscription content. Supported imports are share links, base64 V2Ray-style subscriptions, and sing-box outbound JSON.
8. In `Subscriptions`, create groups from the derived-node chips grid. Each proxy node is one row, and its available derived choices are shown as chips using the endpoint label when available, otherwise the actual endpoint/SNI/direct value. Group preview should only include the selected derived members.
9. In `Subscriptions`, preview V2Ray, PassWall2, and sing-box output after adding nodes and endpoints.

## Browser Flow Verified

The UI was tested with Playwright on `hd01`:

- Wrong admin token shows a visible login failure.
- Correct admin token logs in and loads dashboard metrics.
- Dashboard showed public metric counts before login, then admin details after login.
- Preferred endpoint creation works.
- Batch preferred endpoint creation works from comma/newline-separated values.
- Proxy node creation works.
- Subscription content import creates proxy nodes.
- Clicking a proxy node row loads its source config and current binding selections for inspection/editing.
- Traffic binding uses `Tunnel / SNI` as a multi-select traffic selector and updates tunnel plus additional endpoint selections separately from node source editing.
- Global endpoints are generated for tunnel-backed nodes automatically and are not removable from node binding.
- Group creation stores selected derived-node chip ids and subscription preview filters to those generated members. Saved groups render their members as compact chips.
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
cd /root/builds/cf-tunnel-subscription-manager/worker
export CLOUDFLARE_ACCOUNT_ID=<account id>
export CLOUDFLARE_API_TOKEN=<token with D1 access>
npx wrangler d1 execute cf-tunnel-control-plane --remote --command "
DELETE FROM groups WHERE name LIKE '\''demo-%'\'';
DELETE FROM proxy_node_endpoint_selections WHERE proxy_node_id IN (SELECT id FROM proxy_nodes WHERE name LIKE '\''demo-%'\'');
DELETE FROM proxy_nodes WHERE name LIKE '\''demo-%'\'';
DELETE FROM preferred_endpoint_node_scopes WHERE endpoint_id IN (SELECT id FROM preferred_endpoints WHERE label LIKE '\''demo-%'\'');
DELETE FROM preferred_endpoints WHERE label LIKE '\''demo-%'\'';
"
'
```

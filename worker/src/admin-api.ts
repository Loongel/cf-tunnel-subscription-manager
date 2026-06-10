import { requireAdmin } from "./auth";
import { all, first, run } from "./db";
import { queueRestartCommand } from "./cron";
import { parseEndpointValues, parseProxySubscriptionContent, type ParsedProxyNode } from "./importers";
import { inferProtocol } from "./protocols";
import { getSubscriptionToken, rotateSubscriptionToken, subscriptionUrls } from "./settings";
import { listGeneratedNodes, parseSubscriptionOptions, previewSubscription } from "./subscriptions";
import type { Env, JsonRecord, PreferredEndpointRow, ProxyNodeRow, SubscriptionOptions, TunnelRow } from "./types";
import {
  boolToInt,
  empty,
  HttpError,
  intOrNull,
  json,
  makeId,
  nowIso,
  optionalString,
  readJson,
  requiredString,
  safeJson
} from "./utils";

interface CountRow {
  total: number;
  online?: number;
  healthy?: number;
  unhealthy?: number;
  pending?: number;
}

export async function handlePublicApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/public/overview") {
    return json(await overview(env, false));
  }
  throw new HttpError(404, "public route not found");
}

export async function handleAdminApi(request: Request, env: Env, url: URL): Promise<Response> {
  requireAdmin(request, env);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/admin/overview") {
    return json(await overview(env, true));
  }
  if (request.method === "GET" && path === "/api/admin/agents") {
    return json({ agents: await all(env.DB, "SELECT * FROM agents ORDER BY last_seen_at DESC") });
  }
  if (request.method === "GET" && path === "/api/admin/tunnels") {
    return json({
      tunnels: await all(
        env.DB,
        `SELECT t.*, a.stack_name, a.service_name
         FROM tunnels t
         LEFT JOIN agents a ON a.id = t.agent_id
         ORDER BY t.updated_at DESC`
      )
    });
  }
  if (request.method === "GET" && path === "/api/admin/events") {
    const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
    return json({
      events: await all(
        env.DB,
        "SELECT * FROM tunnel_events ORDER BY created_at DESC LIMIT ?",
        limit
      )
    });
  }

  const restartMatch = /^\/api\/admin\/tunnels\/([^/]+)\/restart$/.exec(path);
  if (request.method === "POST" && restartMatch) {
    return await createRestartCommand(env, restartMatch[1], "admin");
  }

  if (path === "/api/admin/proxy-nodes") {
    if (request.method === "GET") return json({ proxyNodes: await listProxyNodes(env) });
    if (request.method === "POST") return json({ proxyNode: await createProxyNode(env, await readJson(request)) }, { status: 201 });
  }

  if (request.method === "POST" && path === "/api/admin/proxy-nodes/import-subscription") {
    return json(await importProxyNodes(env, await readJson(request)), { status: 201 });
  }

  const proxyNodeMatch = /^\/api\/admin\/proxy-nodes\/([^/]+)$/.exec(path);
  if (proxyNodeMatch) {
    const id = proxyNodeMatch[1];
    if (request.method === "PATCH") return json({ proxyNode: await updateProxyNode(env, id, await readJson(request)) });
    if (request.method === "DELETE") {
      await run(env.DB, "DELETE FROM proxy_nodes WHERE id = ?", id);
      return empty();
    }
  }

  if (path === "/api/admin/preferred-endpoints") {
    if (request.method === "GET") return json({ preferredEndpoints: await listPreferredEndpoints(env) });
    if (request.method === "POST") {
      const preferredEndpoints = await createPreferredEndpoints(env, await readJson(request));
      return json({ preferredEndpoint: preferredEndpoints[0] || null, preferredEndpoints }, { status: 201 });
    }
  }

  const endpointMatch = /^\/api\/admin\/preferred-endpoints\/([^/]+)$/.exec(path);
  if (endpointMatch) {
    const id = endpointMatch[1];
    if (request.method === "PATCH") {
      return json({ preferredEndpoint: await updatePreferredEndpoint(env, id, await readJson(request)) });
    }
    if (request.method === "DELETE") {
      await run(env.DB, "DELETE FROM preferred_endpoints WHERE id = ?", id);
      return empty();
    }
  }

  if (path === "/api/admin/groups") {
    if (request.method === "GET") return json({ groups: await listGroups(env) });
    if (request.method === "POST") return json({ group: await createGroup(env, await readJson(request)) }, { status: 201 });
  }

  const groupMatch = /^\/api\/admin\/groups\/([^/]+)$/.exec(path);
  if (groupMatch) {
    const id = groupMatch[1];
    if (request.method === "PATCH") return json({ group: await updateGroup(env, id, await readJson(request)) });
    if (request.method === "DELETE") {
      await run(env.DB, "DELETE FROM groups WHERE id = ?", id);
      return empty();
    }
  }

  if (request.method === "GET" && path === "/api/admin/subscriptions/preview") {
    const format = url.searchParams.get("format") || "v2ray";
    if (!["v2ray", "passwall2", "sing-box"].includes(format)) {
      throw new HttpError(400, "invalid subscription format");
    }
    return json(await previewSubscription(env, parseSubscriptionOptions(format as SubscriptionOptions["format"], url)));
  }

  if (request.method === "GET" && path === "/api/admin/subscriptions/generated-nodes") {
    const format = url.searchParams.get("format") || "v2ray";
    if (!["v2ray", "passwall2", "sing-box"].includes(format)) {
      throw new HttpError(400, "invalid subscription format");
    }
    const options = parseSubscriptionOptions(format as SubscriptionOptions["format"], url);
    return json({ generatedNodes: await listGeneratedNodes(env, { ...options, group: null }) });
  }

  if (request.method === "POST" && path === "/api/admin/subscriptions/rotate-token") {
    const token = await rotateSubscriptionToken(env);
    return json({ token, subscriptionUrls: subscriptionUrls(env.PUBLIC_BASE_URL || "", token) });
  }

  throw new HttpError(404, "admin route not found");
}

async function overview(env: Env, includePrivate: boolean): Promise<unknown> {
  const agents = await first<CountRow>(
    env.DB,
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END), 0) AS online FROM agents"
  );
  const tunnels = await first<CountRow>(
    env.DB,
    `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN health_status = 'healthy' THEN 1 ELSE 0 END), 0) AS healthy,
      COALESCE(SUM(CASE WHEN health_status = 'unhealthy' THEN 1 ELSE 0 END), 0) AS unhealthy
     FROM tunnels`
  );
  const commands = await first<CountRow>(
    env.DB,
    "SELECT COUNT(*) AS pending FROM commands WHERE status IN ('pending', 'running')"
  );
  const base = {
    agents: agents || { total: 0, online: 0 },
    tunnels: tunnels || { total: 0, healthy: 0, unhealthy: 0 },
    commands: commands || { pending: 0 }
  };
  if (!includePrivate) return base;

  const token = await getSubscriptionToken(env);
  const recent = await all(
    env.DB,
    "SELECT * FROM tunnel_events ORDER BY created_at DESC LIMIT 10"
  );
  return {
    ...base,
    recentEvents: recent,
    subscriptionUrls: subscriptionUrls(env.PUBLIC_BASE_URL || "", token)
  };
}

async function createRestartCommand(env: Env, tunnelId: string, createdBy: "admin" | "cron" | "system"): Promise<Response> {
  const tunnel = await first<TunnelRow>(env.DB, "SELECT * FROM tunnels WHERE id = ?", tunnelId);
  if (!tunnel) throw new HttpError(404, "tunnel not found");
  if (tunnel.type !== "quick") throw new HttpError(400, "only quick tunnels can be restarted");
  const commandId = await queueRestartCommand(env, tunnel, createdBy, "manual restart");
  if (!commandId) return json({ status: "already_pending" });
  return json({ commandId, status: "pending" }, { status: 201 });
}

async function listProxyNodes(env: Env): Promise<unknown[]> {
  const rows = await all<ProxyNodeRow>(
    env.DB,
    `SELECT n.*, t.public_hostname AS tunnel_public_hostname, t.public_url AS tunnel_public_url
     FROM proxy_nodes n
     LEFT JOIN tunnels t ON t.id = n.selected_tunnel_id
     ORDER BY n.name`
  );
  const memberships = await all<{ proxy_node_id: string; group_id: string; group_name: string }>(
    env.DB,
    `SELECT gm.proxy_node_id, g.id AS group_id, g.name AS group_name
     FROM group_members gm JOIN groups g ON g.id = gm.group_id`
  );
  const selections = await all<{ proxy_node_id: string; endpoint_id: string }>(
    env.DB,
    "SELECT proxy_node_id, endpoint_id FROM proxy_node_endpoint_selections WHERE enabled = 1"
  );
  return rows.map((row) => ({
    ...row,
    groups: memberships.filter((item) => item.proxy_node_id === row.id),
    selectedEndpointIds: selections.filter((item) => item.proxy_node_id === row.id).map((item) => item.endpoint_id)
  }));
}

async function createProxyNode(env: Env, body: JsonRecord): Promise<ProxyNodeRow | null> {
  const id = optionalString(body.id) || makeId("node");
  const name = requiredString(body.name, "name");
  const rawConfig = requiredString(body.rawConfig ?? body.raw_config, "rawConfig");
  const sourceType = optionalString(body.sourceType ?? body.source_type) || "v2ray_uri";
  const protocol = optionalString(body.protocol) || inferProtocol(rawConfig, sourceType);
  const timestamp = nowIso();
  await run(
    env.DB,
    `INSERT INTO proxy_nodes
      (id, name, remark, source_type, raw_config, protocol, enabled, use_tunnel, selected_tunnel_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    optionalString(body.remark),
    sourceType,
    rawConfig,
    protocol,
    boolToInt(body.enabled, true),
    boolToInt(body.useTunnel ?? body.use_tunnel),
    optionalString(body.selectedTunnelId ?? body.selected_tunnel_id),
    timestamp,
    timestamp
  );
  await replaceNodeLinks(env, id, body);
  return await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE id = ?", id);
}

async function importProxyNodes(env: Env, body: JsonRecord): Promise<{
  imported: number;
  skipped: number;
  proxyNodes: Array<ProxyNodeRow | null>;
  errors: string[];
}> {
  const sources = await readImportSources(body);
  if (sources.length === 0) throw new HttpError(400, "subscription URL or content is required");

  const namePrefix = optionalString(body.namePrefix ?? body.name_prefix);
  const remark = optionalString(body.remark);
  const imported: Array<ProxyNodeRow | null> = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const source of sources) {
    let parsed: ParsedProxyNode[];
    try {
      parsed = parseProxySubscriptionContent(source.content, source.name);
    } catch (error) {
      errors.push(`${source.name}: ${error instanceof Error ? error.message : "parse failed"}`);
      continue;
    }
    if (parsed.length === 0) {
      skipped += 1;
      errors.push(`${source.name}: no supported proxy nodes found`);
      continue;
    }

    for (const item of parsed) {
      imported.push(await createProxyNode(env, {
        name: namePrefix ? `${namePrefix} ${item.name}` : item.name,
        remark: remark || source.name,
        rawConfig: item.rawConfig,
        sourceType: item.sourceType,
        protocol: item.protocol,
        enabled: body.enabled === undefined ? true : body.enabled,
        useTunnel: false,
        selectedEndpointIds: []
      }));
    }
  }

  return { imported: imported.length, skipped, proxyNodes: imported, errors };
}

async function readImportSources(body: JsonRecord): Promise<Array<{ name: string; content: string }>> {
  const sources: Array<{ name: string; content: string }> = [];
  const content = optionalString(body.content);
  if (content) {
    sources.push({ name: optionalString(body.sourceName ?? body.source_name) || "pasted-subscription", content });
  }

  const urls = parseEndpointValues(body.url ?? body.urls);
  for (const sourceUrl of urls) {
    const res = await fetch(sourceUrl, {
      headers: { "user-agent": "cf-tunnel-control-plane/0.1" }
    });
    if (!res.ok) throw new HttpError(400, `failed to fetch ${sourceUrl}: HTTP ${res.status}`);
    sources.push({ name: sourceUrl, content: await res.text() });
  }
  return sources;
}

async function updateProxyNode(env: Env, id: string, body: JsonRecord): Promise<ProxyNodeRow | null> {
  const current = await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE id = ?", id);
  if (!current) throw new HttpError(404, "proxy node not found");
  const rawConfig = optionalString(body.rawConfig ?? body.raw_config) || current.raw_config;
  const sourceType = optionalString(body.sourceType ?? body.source_type) || current.source_type;
  await run(
    env.DB,
    `UPDATE proxy_nodes SET
      name = ?, remark = ?, source_type = ?, raw_config = ?, protocol = ?,
      enabled = ?, use_tunnel = ?, selected_tunnel_id = ?, updated_at = ?
     WHERE id = ?`,
    optionalString(body.name) || current.name,
    body.remark === null ? null : optionalString(body.remark) || current.remark,
    sourceType,
    rawConfig,
    optionalString(body.protocol) || inferProtocol(rawConfig, sourceType),
    body.enabled === undefined ? current.enabled : boolToInt(body.enabled),
    body.useTunnel === undefined && body.use_tunnel === undefined ? current.use_tunnel : boolToInt(body.useTunnel ?? body.use_tunnel),
    body.selectedTunnelId === undefined && body.selected_tunnel_id === undefined
      ? current.selected_tunnel_id
      : optionalString(body.selectedTunnelId ?? body.selected_tunnel_id),
    nowIso(),
    id
  );
  await replaceNodeLinks(env, id, body);
  return await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE id = ?", id);
}

async function replaceNodeLinks(env: Env, nodeId: string, body: JsonRecord): Promise<void> {
  if (Array.isArray(body.groupIds)) {
    await run(env.DB, "DELETE FROM group_members WHERE proxy_node_id = ?", nodeId);
    for (const groupId of body.groupIds) {
      if (typeof groupId === "string") {
        await run(env.DB, "INSERT OR IGNORE INTO group_members (group_id, proxy_node_id) VALUES (?, ?)", groupId, nodeId);
      }
    }
  }
  if (Array.isArray(body.selectedEndpointIds)) {
    await run(env.DB, "DELETE FROM proxy_node_endpoint_selections WHERE proxy_node_id = ?", nodeId);
    for (const endpointId of body.selectedEndpointIds) {
      if (typeof endpointId === "string") {
        await run(
          env.DB,
          "INSERT OR REPLACE INTO proxy_node_endpoint_selections (proxy_node_id, endpoint_id, enabled) VALUES (?, ?, 1)",
          nodeId,
          endpointId
        );
      }
    }
  }
}

async function listPreferredEndpoints(env: Env): Promise<unknown[]> {
  const endpoints = await all<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints ORDER BY sort_order, value");
  const scopes = await all<{ endpoint_id: string; proxy_node_id: string }>(env.DB, "SELECT * FROM preferred_endpoint_node_scopes");
  return endpoints.map((endpoint) => ({
    ...endpoint,
    proxyNodeIds: scopes.filter((scope) => scope.endpoint_id === endpoint.id).map((scope) => scope.proxy_node_id)
  }));
}

async function createPreferredEndpoint(env: Env, body: JsonRecord): Promise<PreferredEndpointRow | null> {
  return (await createPreferredEndpointForValue(env, body, requiredString(body.value, "value"))).row;
}

async function createPreferredEndpoints(env: Env, body: JsonRecord): Promise<PreferredEndpointRow[]> {
  const values = parseEndpointValues(body.values ?? body.value);
  if (values.length === 0) throw new HttpError(400, "value is required");
  const output: PreferredEndpointRow[] = [];
  for (const value of values) {
    const result = await createPreferredEndpointForValue(env, body, value);
    if (result.row) output.push(result.row);
  }
  return output;
}

async function createPreferredEndpointForValue(
  env: Env,
  body: JsonRecord,
  value: string
): Promise<{ row: PreferredEndpointRow | null }> {
  const id = optionalString(body.id) || makeId("endpoint");
  const type = requiredString(body.type, "type");
  if (type !== "ip" && type !== "domain") throw new HttpError(400, "type must be ip or domain");
  const scope = optionalString(body.scope) || "global";
  if (scope !== "global" && scope !== "node") throw new HttpError(400, "scope must be global or node");
  const timestamp = nowIso();
  const existing = await first<PreferredEndpointRow>(
    env.DB,
    "SELECT * FROM preferred_endpoints WHERE type = ? AND value = ? AND scope = ?",
    type,
    value,
    scope
  );
  if (existing) {
    await run(
      env.DB,
      `UPDATE preferred_endpoints SET
        label = ?, enabled = ?, default_selected = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
      body.label === undefined ? existing.label : optionalString(body.label),
      body.enabled === undefined ? existing.enabled : boolToInt(body.enabled, true),
      body.defaultSelected === undefined && body.default_selected === undefined
        ? existing.default_selected
        : boolToInt(body.defaultSelected ?? body.default_selected),
      intOrNull(body.sortOrder ?? body.sort_order) ?? existing.sort_order,
      timestamp,
      existing.id
    );
    await replaceEndpointScopes(env, existing.id, body);
    return { row: await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", existing.id) };
  }

  await run(
    env.DB,
    `INSERT INTO preferred_endpoints
      (id, type, value, label, enabled, scope, default_selected, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    type,
    value,
    optionalString(body.label),
    boolToInt(body.enabled, true),
    scope,
    boolToInt(body.defaultSelected ?? body.default_selected),
    intOrNull(body.sortOrder ?? body.sort_order) || 0,
    timestamp,
    timestamp
  );
  await replaceEndpointScopes(env, id, body);
  return { row: await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", id) };
}

async function updatePreferredEndpoint(env: Env, id: string, body: JsonRecord): Promise<PreferredEndpointRow | null> {
  const current = await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", id);
  if (!current) throw new HttpError(404, "preferred endpoint not found");
  const type = optionalString(body.type) || current.type;
  const scope = optionalString(body.scope) || current.scope;
  await run(
    env.DB,
    `UPDATE preferred_endpoints SET
      type = ?, value = ?, label = ?, enabled = ?, scope = ?, default_selected = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
    type,
    optionalString(body.value) || current.value,
    body.label === null ? null : optionalString(body.label) || current.label,
    body.enabled === undefined ? current.enabled : boolToInt(body.enabled),
    scope,
    body.defaultSelected === undefined && body.default_selected === undefined
      ? current.default_selected
      : boolToInt(body.defaultSelected ?? body.default_selected),
    intOrNull(body.sortOrder ?? body.sort_order) ?? current.sort_order,
    nowIso(),
    id
  );
  await replaceEndpointScopes(env, id, body);
  return await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", id);
}

async function replaceEndpointScopes(env: Env, endpointId: string, body: JsonRecord): Promise<void> {
  if (!Array.isArray(body.proxyNodeIds)) return;
  await run(env.DB, "DELETE FROM preferred_endpoint_node_scopes WHERE endpoint_id = ?", endpointId);
  for (const nodeId of body.proxyNodeIds) {
    if (typeof nodeId === "string") {
      await run(
        env.DB,
        "INSERT OR IGNORE INTO preferred_endpoint_node_scopes (endpoint_id, proxy_node_id) VALUES (?, ?)",
        endpointId,
        nodeId
      );
    }
  }
}

async function listGroups(env: Env): Promise<unknown[]> {
  const groups = await all<Record<string, unknown>>(env.DB, "SELECT * FROM groups ORDER BY sort_order, name");
  const members = await all<{ group_id: string; proxy_node_id: string }>(env.DB, "SELECT * FROM group_members");
  return groups.map((group) => ({
    ...group,
    derivedNodeIds: derivedNodeIdsFromFilter(String(group.endpoint_filter_json || "{}")),
    proxyNodeIds: members.filter((member) => member.group_id === group.id).map((member) => member.proxy_node_id)
  }));
}

async function createGroup(env: Env, body: JsonRecord): Promise<unknown> {
  const id = optionalString(body.id) || makeId("grp");
  const timestamp = nowIso();
  await run(
    env.DB,
    `INSERT INTO groups
      (id, name, remark, endpoint_mode, endpoint_filter_json, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    requiredString(body.name, "name"),
    optionalString(body.remark),
    optionalString(body.endpointMode ?? body.endpoint_mode) || "selected",
    groupEndpointFilterJson(body),
    boolToInt(body.enabled, true),
    intOrNull(body.sortOrder ?? body.sort_order) || 0,
    timestamp,
    timestamp
  );
  await replaceGroupMembers(env, id, body);
  return await first(env.DB, "SELECT * FROM groups WHERE id = ?", id);
}

async function updateGroup(env: Env, id: string, body: JsonRecord): Promise<unknown> {
  const current = await first<Record<string, unknown>>(env.DB, "SELECT * FROM groups WHERE id = ?", id);
  if (!current) throw new HttpError(404, "group not found");
  await run(
    env.DB,
    `UPDATE groups SET name = ?, remark = ?, endpoint_mode = ?, endpoint_filter_json = ?,
      enabled = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
    optionalString(body.name) || String(current.name),
    body.remark === null ? null : optionalString(body.remark) || (current.remark as string | null),
    optionalString(body.endpointMode ?? body.endpoint_mode) || String(current.endpoint_mode),
    body.endpointFilter === undefined && body.endpoint_filter === undefined
      && body.derivedNodeIds === undefined && body.derived_node_ids === undefined
      ? String(current.endpoint_filter_json)
      : groupEndpointFilterJson(body),
    body.enabled === undefined ? Number(current.enabled) : boolToInt(body.enabled),
    intOrNull(body.sortOrder ?? body.sort_order) ?? Number(current.sort_order),
    nowIso(),
    id
  );
  await replaceGroupMembers(env, id, body);
  return await first(env.DB, "SELECT * FROM groups WHERE id = ?", id);
}

function groupEndpointFilterJson(body: JsonRecord): string {
  const filter = body.endpointFilter || body.endpoint_filter || {};
  const record = typeof filter === "object" && filter !== null && !Array.isArray(filter)
    ? { ...(filter as Record<string, unknown>) }
    : {};
  const ids = body.derivedNodeIds ?? body.derived_node_ids;
  if (Array.isArray(ids)) {
    record.derivedNodeIds = ids.filter((id): id is string => typeof id === "string");
  }
  return safeJson(record);
}

function derivedNodeIdsFromFilter(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const ids = (parsed as { derivedNodeIds?: unknown }).derivedNodeIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function replaceGroupMembers(env: Env, groupId: string, body: JsonRecord): Promise<void> {
  if (!Array.isArray(body.proxyNodeIds)) return;
  await run(env.DB, "DELETE FROM group_members WHERE group_id = ?", groupId);
  for (const nodeId of body.proxyNodeIds) {
    if (typeof nodeId === "string") {
      await run(env.DB, "INSERT OR IGNORE INTO group_members (group_id, proxy_node_id) VALUES (?, ?)", groupId, nodeId);
    }
  }
}

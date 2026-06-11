import { requireAdmin } from "./auth";
import { all, first, run } from "./db";
import { queueRestartCommand } from "./cron";
import {
  composeFallbackRawConfig,
  parseEndpointValues,
  parseProxySubscriptionContent,
  type ParsedProxyNode
} from "./importers";
import { inferProtocol } from "./protocols";
import { getSubscriptionToken, rotateSubscriptionToken, subscriptionUrls } from "./settings";
import { listGeneratedNodes, parseSubscriptionOptions, previewSubscription } from "./subscriptions";
import { cleanupStaleTunnels, tunnelTrafficKey, tunnelTrafficLabel } from "./tunnel-registry";
import type { CustomSniRow, Env, ImportSourceRow, JsonRecord, JsonValue, PreferredEndpointRow, ProxyNodeRow, SubscriptionOptions, TunnelRow } from "./types";
import {
  boolToInt,
  empty,
  HttpError,
  intOrNull,
  json,
  makeId,
  nowIso,
  optionalString,
  parseJsonObject,
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

interface DeletedImportedNodeRow {
  id: string;
  name: string;
  selectedEndpointIds: string[];
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
    await cleanupStaleTunnels(env);
    const tunnels = await all<Record<string, unknown>>(
      env.DB,
      `SELECT t.*, a.stack_name, a.service_name
       FROM tunnels t
       LEFT JOIN agents a ON a.id = t.agent_id
       ORDER BY t.updated_at DESC`
    );
    return json({
      tunnels: tunnels.map((tunnel) => {
        const identity = {
          swarm_node_name: typeof tunnel.swarm_node_name === "string" ? tunnel.swarm_node_name : null,
          target_url: typeof tunnel.target_url === "string" ? tunnel.target_url : null,
          remark: typeof tunnel.remark === "string" ? tunnel.remark : null
        };
        return {
          ...tunnel,
          traffic_key: tunnelTrafficKey(identity),
          traffic_label: tunnelTrafficLabel(identity)
        };
      })
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

  const tunnelMatch = /^\/api\/admin\/tunnels\/([^/]+)$/.exec(path);
  if (tunnelMatch) {
    const id = tunnelMatch[1];
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const remark = body.remark === null ? null : optionalString(body.remark);
      await run(
        env.DB,
        "UPDATE tunnels SET remark = ?, updated_at = ? WHERE id = ?",
        remark === undefined ? null : remark,
        nowIso(),
        id
      );
      const tunnel = await first(env.DB, "SELECT * FROM tunnels WHERE id = ?", id);
      return json({ tunnel });
    }
  }

  const agentMatch = /^\/api\/admin\/agents\/([^/]+)$/.exec(path);
  if (agentMatch) {
    const id = agentMatch[1];
    if (request.method === "DELETE") {
      await run(env.DB, "DELETE FROM agents WHERE id = ?", id);
      return empty();
    }
  }

  if (path === "/api/admin/proxy-nodes") {
    if (request.method === "GET") return json({ proxyNodes: await listProxyNodes(env) });
    if (request.method === "POST") return json({ proxyNode: await createProxyNode(env, await readJson(request)) }, { status: 201 });
  }

  if (request.method === "POST" && path === "/api/admin/proxy-nodes/import-subscription") {
    return json(await importProxyNodes(env, await readJson(request)), { status: 201 });
  }

  if (request.method === "POST" && path === "/api/admin/proxy-nodes/import-preview") {
    return json(await previewProxyNodeImport(env, await readJson(request)));
  }

  if (path === "/api/admin/custom-snis") {
    if (request.method === "GET") return json({ customSnis: await listCustomSnis(env) });
    if (request.method === "POST") return json({ customSni: await createCustomSni(env, await readJson(request)) }, { status: 201 });
  }

  const customSniMatch = /^\/api\/admin\/custom-snis\/([^/]+)$/.exec(path);
  if (customSniMatch) {
    const id = customSniMatch[1];
    if (request.method === "PATCH") return json({ customSni: await updateCustomSni(env, id, await readJson(request)) });
    if (request.method === "DELETE") {
      await run(env.DB, "DELETE FROM custom_snis WHERE id = ?", id);
      return empty();
    }
  }

  if (path === "/api/admin/import-sources") {
    if (request.method === "GET") return json({ importSources: await listImportSources(env) });
    if (request.method === "POST") return json({ importSource: await createImportSource(env, await readJson(request)) }, { status: 201 });
  }

  const importSourceRefreshMatch = /^\/api\/admin\/import-sources\/([^/]+)\/refresh$/.exec(path);
  if (request.method === "POST" && importSourceRefreshMatch) {
    return json(await refreshImportSource(env, importSourceRefreshMatch[1], "manual"));
  }

  const importSourcePreviewMatch = /^\/api\/admin\/import-sources\/([^/]+)\/preview$/.exec(path);
  if (request.method === "GET" && importSourcePreviewMatch) {
    return json(await previewImportSource(env, importSourcePreviewMatch[1]));
  }

  const importSourceMatch = /^\/api\/admin\/import-sources\/([^/]+)$/.exec(path);
  if (importSourceMatch) {
    const id = importSourceMatch[1];
    if (request.method === "PATCH") return json({ importSource: await updateImportSource(env, id, await readJson(request)) });
    if (request.method === "DELETE") {
      await run(env.DB, "DELETE FROM import_sources WHERE id = ?", id);
      return empty();
    }
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
  await cleanupStaleTunnels(env);
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
  const selections = await all<{ proxy_node_id: string; endpoint_id: string }>(
    env.DB,
    "SELECT proxy_node_id, endpoint_id FROM proxy_node_endpoint_selections WHERE enabled = 1"
  );
  const tunnelSelections = await all<{ proxy_node_id: string; tunnel_id: string }>(
    env.DB,
    "SELECT proxy_node_id, tunnel_id FROM proxy_node_tunnel_selections WHERE enabled = 1"
  );
  const trafficBindings = await all<{ proxy_node_id: string; traffic_key: string }>(
    env.DB,
    "SELECT proxy_node_id, traffic_key FROM proxy_node_traffic_bindings WHERE enabled = 1"
  );
  const sniSelections = await all<{ proxy_node_id: string; sni_id: string }>(
    env.DB,
    "SELECT proxy_node_id, sni_id FROM proxy_node_sni_selections WHERE enabled = 1"
  );
  return rows.map((row) => ({
    ...row,
    selectedEndpointIds: selections.filter((item) => item.proxy_node_id === row.id).map((item) => item.endpoint_id),
    selectedTunnelIds: selectedTunnelIdsForRow(row, tunnelSelections),
    selectedTrafficKeys: trafficBindings.filter((item) => item.proxy_node_id === row.id).map((item) => item.traffic_key),
    selectedSniIds: sniSelections.filter((item) => item.proxy_node_id === row.id).map((item) => item.sni_id),
    selectedTrafficIds: [
      ...trafficBindings.filter((item) => item.proxy_node_id === row.id).map((item) => `traffic:${item.traffic_key}`),
      ...sniSelections.filter((item) => item.proxy_node_id === row.id).map((item) => `sni:${item.sni_id}`)
    ]
  }));
}

function selectedTunnelIdsForRow(
  row: ProxyNodeRow,
  selections: Array<{ proxy_node_id: string; tunnel_id: string }>
): string[] {
  const ids = selections.filter((item) => item.proxy_node_id === row.id).map((item) => item.tunnel_id);
  if (ids.length > 0) return ids;
  return row.selected_tunnel_id ? [row.selected_tunnel_id] : [];
}

async function createProxyNode(env: Env, body: JsonRecord): Promise<ProxyNodeRow | null> {
  const id = optionalString(body.id) || makeId("node");
  const name = requiredString(body.name, "name");
  const rawConfig = requiredString(body.rawConfig, "rawConfig");
  const sourceType = optionalString(body.sourceType) || "v2ray_uri";
  const protocol = optionalString(body.protocol) || inferProtocol(rawConfig, sourceType);
  const selectedTunnelIds = selectedTunnelIdsFromBody(body);
  const selectedTrafficKeys = selectedTrafficKeysFromBody(body);
  const selectedSniIds = selectedSniIdsFromBody(body);
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
    body.useTunnel === undefined
      ? boolToInt(selectedTunnelIds.length > 0 || selectedTrafficKeys.length > 0 || selectedSniIds.length > 0)
      : boolToInt(body.useTunnel),
    selectedTunnelIds[0] || null,
    timestamp,
    timestamp
  );
  await replaceNodeLinks(env, id, body);
  return await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE id = ?", id);
}

async function importProxyNodes(env: Env, body: JsonRecord): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  deletedOld: number;
  proxyNodes: Array<ProxyNodeRow | null>;
  errors: string[];
}> {
  const candidates = Array.isArray(body.candidates)
    ? normalizeImportCandidates(body.candidates)
    : (await buildImportCandidates(env, body)).candidates;
  const activeCandidates = candidates.filter((item) => !item.removed);
  if (activeCandidates.length === 0) throw new HttpError(400, "no import candidates selected");

  const remark = optionalString(body.remark);
  const imported: Array<ProxyNodeRow | null> = [];
  const errors: string[] = [];
  const byId = new Map(activeCandidates.map((item) => [item.id, item]));
  const seenNames = new Set<string>();
  const newIdsByName = new Map<string, string>();
  let skipped = 0;
  let created = 0;
  let updated = 0;
  let deletedOld = 0;
  let deletedRows: DeletedImportedNodeRow[] = [];

  if (body.replaceExistingForRemark === true && remark) {
    deletedRows = await deleteImportedNodesByRemarks(env, replacementRemarks(body, remark));
    deletedOld = deletedRows.length;
  }

  const deletedEndpointIdsByName = endpointSelectionsByDeletedName(deletedRows);

  for (const item of activeCandidates) {
    const name = item.name.trim();
    if (!name || seenNames.has(name)) {
      skipped += 1;
      continue;
    }

    const carrierIds = item.parentIds || [];
    const validCarriers = carrierIds
      .map((id) => byId.get(id))
      .filter((carrier): carrier is ImportCandidate => Boolean(carrier));
    if (carrierIds.length > 0 && validCarriers.length === 0) {
      skipped += 1;
      errors.push(`${item.name}: selected TLS carrier not found`);
      continue;
    }

    const variants = validCarriers.length > 0
      ? validCarriers.map((carrier) => ({
        name: validCarriers.length > 1 ? `${name} @ ${carrier.name}` : name,
        rawConfig: composeFallbackRawConfig(item.rawConfig, item.sourceType, carrier.rawConfig, carrier.sourceType)
      }))
      : [{ name, rawConfig: item.rawConfig }];

    for (const variant of variants) {
      if (seenNames.has(variant.name)) {
        skipped += 1;
        continue;
      }
      seenNames.add(variant.name);
      try {
        const stableId = await stableImportedNodeId(remark || item.sourceName, variant.name);
        const restoredEndpointIds = deletedEndpointIdsByName.get(variant.name) || [];
        newIdsByName.set(variant.name, stableId);
        const payload = {
          name: variant.name,
          remark: remark || item.sourceName,
          rawConfig: variant.rawConfig,
          sourceType: item.sourceType,
          protocol: item.protocol,
          enabled: body.enabled === undefined ? true : body.enabled,
          useTunnel: false,
          ...(restoredEndpointIds.length > 0 ? { selectedEndpointIds: restoredEndpointIds as unknown as JsonValue } : {}),
          id: stableId
        };
        const result = body.replaceExistingForRemark === true && remark
          ? { row: await createProxyNode(env, payload), created: true }
          : await upsertProxyNodeByName(env, payload);
        imported.push(result.row);
        if (result.created) created += 1;
        else updated += 1;
      } catch (error) {
        skipped += 1;
        errors.push(`${variant.name}: ${error instanceof Error ? error.message : "import failed"}`);
      }
    }
  }

  if (deletedRows.length > 0 && newIdsByName.size > 0) {
    await migrateGroupDerivedNodeIds(env, deletedRows, newIdsByName);
  }

  return { imported: created, updated, skipped, deletedOld, proxyNodes: imported, errors };
}

function replacementRemarks(body: JsonRecord, remark: string): string[] {
  return Array.from(new Set([remark, ...parseEndpointValues(body.replaceExistingRemarks)]));
}

async function deleteImportedNodesByRemarks(env: Env, remarks: string[]): Promise<DeletedImportedNodeRow[]> {
  if (remarks.length === 0) return [];
  const placeholders = remarks.map(() => "?").join(", ");
  const rows = await all<{ id: string; name: string }>(
    env.DB,
    `SELECT id, name FROM proxy_nodes WHERE remark IN (${placeholders})`,
    ...remarks
  );
  const selectedEndpointIdsByNodeId = await selectedNodeScopedEndpointIds(env, rows.map((row) => row.id));
  await run(env.DB, `DELETE FROM proxy_nodes WHERE remark IN (${placeholders})`, ...remarks);
  return rows.map((row) => ({
    ...row,
    selectedEndpointIds: selectedEndpointIdsByNodeId.get(row.id) || []
  }));
}

async function selectedNodeScopedEndpointIds(env: Env, nodeIds: string[]): Promise<Map<string, string[]>> {
  const output = new Map<string, string[]>();
  if (nodeIds.length === 0) return output;
  const placeholders = nodeIds.map(() => "?").join(", ");
  const rows = await all<{ proxy_node_id: string; endpoint_id: string }>(
    env.DB,
    `SELECT s.proxy_node_id, s.endpoint_id
     FROM proxy_node_endpoint_selections s
     JOIN preferred_endpoints e ON e.id = s.endpoint_id
     WHERE s.enabled = 1
       AND e.scope = 'node'
       AND s.proxy_node_id IN (${placeholders})`,
    ...nodeIds
  );
  for (const row of rows) {
    const ids = output.get(row.proxy_node_id) || [];
    ids.push(row.endpoint_id);
    output.set(row.proxy_node_id, ids);
  }
  return output;
}

function endpointSelectionsByDeletedName(rows: DeletedImportedNodeRow[]): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const row of rows) {
    if (row.selectedEndpointIds.length === 0) continue;
    const ids = output.get(row.name) || [];
    for (const endpointId of row.selectedEndpointIds) {
      if (!ids.includes(endpointId)) ids.push(endpointId);
    }
    output.set(row.name, ids);
  }
  return output;
}

async function stableImportedNodeId(sourceName: string, nodeName: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${sourceName}\n${nodeName}`);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `node_${hex.slice(0, 32)}`;
}

async function migrateGroupDerivedNodeIds(
  env: Env,
  deletedRows: Array<{ id: string; name: string }>,
  newIdsByName: Map<string, string>
): Promise<void> {
  const oldToNewId = new Map<string, string>();
  for (const row of deletedRows) {
    const newId = newIdsByName.get(row.name);
    if (newId) oldToNewId.set(row.id, newId);
  }
  if (oldToNewId.size === 0) return;

  const groups = await all<{ id: string; endpoint_filter_json: string }>(
    env.DB,
    "SELECT id, endpoint_filter_json FROM groups"
  );
  for (const group of groups) {
    const filter = parseJsonObject(group.endpoint_filter_json);
    if (!Array.isArray(filter.derivedNodeIds)) continue;
    let changed = false;
    const derivedNodeIds = filter.derivedNodeIds.map((value) => {
      if (typeof value !== "string") return value;
      for (const [oldId, newId] of oldToNewId) {
        if (value.startsWith(`${oldId}:`)) {
          changed = true;
          return `${newId}:${value.slice(oldId.length + 1)}`;
        }
      }
      return value;
    });
    if (changed) {
      filter.derivedNodeIds = derivedNodeIds as JsonValue;
      await run(
        env.DB,
        "UPDATE groups SET endpoint_filter_json = ?, updated_at = ? WHERE id = ?",
        safeJson(filter),
        nowIso(),
        group.id
      );
    }
  }
}

export const __adminApiTestHooks = {
  importProxyNodes
};

async function previewProxyNodeImport(env: Env, body: JsonRecord): Promise<{
  candidates: ImportCandidate[];
  errors: string[];
}> {
  return await buildImportCandidates(env, body);
}

interface ImportCandidate {
  id: string;
  name: string;
  sourceName: string;
  rawConfig: string;
  sourceType: "v2ray_uri" | "sing_box_outbound";
  protocol: string;
  server?: string;
  port?: string;
  sni?: string;
  transport?: string;
  tls: boolean;
  asTlsCarrier?: boolean;
  duplicate: boolean;
  removed?: boolean;
  parentIds?: string[];
}

async function buildImportCandidates(env: Env, body: JsonRecord): Promise<{
  candidates: ImportCandidate[];
  errors: string[];
}> {
  const sources = await readImportSources(body);
  if (sources.length === 0) throw new HttpError(400, "subscription URL or content is required");
  const namePrefix = optionalString(body.namePrefix);
  const existing = await all<{ name: string }>(env.DB, "SELECT name FROM proxy_nodes");
  const existingNames = new Set(existing.map((row) => row.name));
  const candidates: ImportCandidate[] = [];
  const errors: string[] = [];

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex];
    let parsed: ParsedProxyNode[];
    try {
      parsed = parseProxySubscriptionContent(source.content, source.name);
    } catch (error) {
      errors.push(`${source.name}: ${error instanceof Error ? error.message : "parse failed"}`);
      continue;
    }
    if (parsed.length === 0) {
      errors.push(`${source.name}: no supported proxy nodes found`);
      continue;
    }

    parsed.forEach((item, itemIndex) => {
      const name = namePrefix ? `${namePrefix} ${item.name}` : item.name;
      candidates.push({
        id: `candidate_${sourceIndex}_${itemIndex}`,
        name,
        sourceName: source.name,
        rawConfig: item.rawConfig,
        sourceType: item.sourceType,
        protocol: item.protocol,
        server: item.server,
        port: item.port,
        sni: item.sni,
        transport: item.transport,
        tls: item.tls,
        duplicate: existingNames.has(name)
      });
    });
  }

  return { candidates, errors };
}

function applyImportRules(candidates: ImportCandidate[], rules: JsonRecord): ImportCandidate[] {
  const excludeKeywords = stringArray(rules.excludeKeywords).map((item) => item.toLowerCase());
  const includeKeywords = stringArray(rules.includeKeywords).map((item) => item.toLowerCase());
  const removedNames = new Set(stringArray(rules.removedNames));
  const carrierNames = new Set(stringArray(rules.carrierNames));
  const parentNamesByName = isRecord(rules.parentNamesByName)
    ? rules.parentNamesByName as JsonRecord
    : {};
  const byName = new Map(candidates.map((item) => [item.name, item]));

  for (const item of candidates) {
    const haystack = [item.name, item.protocol, item.server, item.sni, item.transport, item.sourceName].filter(Boolean).join(" ").toLowerCase();
    const includeMatched = includeKeywords.length === 0 || includeKeywords.some((keyword) => haystack.includes(keyword));
    const excludeMatched = excludeKeywords.some((keyword) => haystack.includes(keyword));
    item.removed = removedNames.has(item.name) || !includeMatched || excludeMatched;
    item.asTlsCarrier = carrierNames.has(item.name);
  }

  for (const item of candidates) {
    const parentNames = stringArray(parentNamesByName[item.name]);
    const parents = Array.from(new Set(parentNames))
      .map((name) => byName.get(name))
      .filter((parent): parent is ImportCandidate => Boolean(parent && parent.asTlsCarrier && !item.removed && !parent.removed));
    if (parents.length > 0) {
      item.parentIds = parents.map((parent) => parent.id);
    }
  }
  return candidates;
}

function importRulesFromBody(body: JsonRecord): JsonRecord {
  const inputRules = isRecord(body.rules) ? body.rules as JsonRecord : {};
  const rules: JsonRecord = {};
  const excludeKeywords = parseEndpointValues(body.excludeKeywords ?? inputRules.excludeKeywords);
  const includeKeywords = parseEndpointValues(body.includeKeywords ?? inputRules.includeKeywords);
  if (excludeKeywords.length > 0) rules.excludeKeywords = excludeKeywords;
  if (includeKeywords.length > 0) rules.includeKeywords = includeKeywords;
  const removedNames = body.removedNames ?? inputRules.removedNames;
  if (Array.isArray(removedNames)) {
    rules.removedNames = stringArray(removedNames);
  }
  const parentNamesByName = body.parentNamesByName ?? inputRules.parentNamesByName;
  if (isRecord(parentNamesByName)) {
    rules.parentNamesByName = parentNamesByName;
  }
  const carrierNames = body.carrierNames ?? inputRules.carrierNames;
  if (Array.isArray(carrierNames)) {
    rules.carrierNames = stringArray(carrierNames);
  }
  return rules;
}

function currentImportRules(rules: JsonRecord): JsonRecord {
  return importRulesFromBody({ rules });
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeImportCandidates(value: unknown[]): ImportCandidate[] {
  return value
    .filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item, index) => {
      const sourceType = optionalString(item.sourceType) === "sing_box_outbound" ? "sing_box_outbound" : "v2ray_uri";
      const rawConfig = requiredString(item.rawConfig, "candidate.rawConfig");
      return {
        id: optionalString(item.id) || `candidate_${index}`,
        name: requiredString(item.name, "candidate.name"),
        sourceName: optionalString(item.sourceName) || "import",
        rawConfig,
        sourceType,
        protocol: optionalString(item.protocol) || inferProtocol(rawConfig, sourceType),
        server: optionalString(item.server) || undefined,
        port: optionalString(item.port) || undefined,
        sni: optionalString(item.sni) || undefined,
        transport: optionalString(item.transport) || undefined,
        tls: Boolean(item.tls),
        asTlsCarrier: Boolean(item.asTlsCarrier),
        duplicate: Boolean(item.duplicate),
        removed: Boolean(item.removed),
        parentIds: stringArray(item.parentIds)
      };
    });
}

async function listCustomSnis(env: Env): Promise<CustomSniRow[]> {
  return await all<CustomSniRow>(env.DB, "SELECT * FROM custom_snis ORDER BY sort_order, name");
}

async function createCustomSni(env: Env, body: JsonRecord): Promise<CustomSniRow | null> {
  const hostname = requiredString(body.hostname ?? body.value, "hostname");
  const timestamp = nowIso();
  const existing = await first<CustomSniRow>(env.DB, "SELECT * FROM custom_snis WHERE hostname = ?", hostname);
  if (existing) {
    return await updateCustomSni(env, existing.id, body);
  }
  const id = optionalString(body.id) || makeId("sni");
  await run(
    env.DB,
    `INSERT INTO custom_snis (id, name, hostname, remark, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    optionalString(body.name) || hostname,
    hostname,
    optionalString(body.remark),
    boolToInt(body.enabled, true),
    intOrNull(body.sortOrder) || 0,
    timestamp,
    timestamp
  );
  return await first<CustomSniRow>(env.DB, "SELECT * FROM custom_snis WHERE id = ?", id);
}

async function updateCustomSni(env: Env, id: string, body: JsonRecord): Promise<CustomSniRow | null> {
  const current = await first<CustomSniRow>(env.DB, "SELECT * FROM custom_snis WHERE id = ?", id);
  if (!current) throw new HttpError(404, "SNI not found");
  await run(
    env.DB,
    `UPDATE custom_snis SET name = ?, hostname = ?, remark = ?, enabled = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
    optionalString(body.name) || current.name,
    optionalString(body.hostname ?? body.value) || current.hostname,
    body.remark === null ? null : optionalString(body.remark) || current.remark,
    body.enabled === undefined ? current.enabled : boolToInt(body.enabled),
    intOrNull(body.sortOrder) ?? current.sort_order,
    nowIso(),
    id
  );
  return await first<CustomSniRow>(env.DB, "SELECT * FROM custom_snis WHERE id = ?", id);
}

async function listImportSources(env: Env): Promise<unknown[]> {
  const rows = await all<ImportSourceRow>(env.DB, "SELECT * FROM import_sources ORDER BY updated_at DESC, name");
  return rows.map((row) => {
    const rules = currentImportRules(parseJsonObject(row.rules_json));
    return {
      ...row,
      rules_json: safeJson(rules),
      rules
    };
  });
}

async function createImportSource(env: Env, body: JsonRecord): Promise<ImportSourceRow | null> {
  const id = optionalString(body.id) || makeId("import");
  const timestamp = nowIso();
  const name = requiredString(body.name, "name");
  const sourceKind = optionalString(body.sourceKind) || "url";
  if (sourceKind !== "url" && sourceKind !== "content") throw new HttpError(400, "sourceKind must be url or content");
  await run(
    env.DB,
    `INSERT INTO import_sources
      (id, name, source_kind, url, content, name_prefix, enabled, rules_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    sourceKind,
    optionalString(body.url),
    optionalString(body.content),
    optionalString(body.namePrefix),
    boolToInt(body.enabled, true),
    safeJson(importRulesFromBody(body)),
    timestamp,
    timestamp
  );
  return await first<ImportSourceRow>(env.DB, "SELECT * FROM import_sources WHERE id = ?", id);
}

async function updateImportSource(env: Env, id: string, body: JsonRecord): Promise<ImportSourceRow | null> {
  const current = await first<ImportSourceRow>(env.DB, "SELECT * FROM import_sources WHERE id = ?", id);
  if (!current) throw new HttpError(404, "import source not found");
  const sourceKind = optionalString(body.sourceKind) || current.source_kind;
  if (sourceKind !== "url" && sourceKind !== "content") throw new HttpError(400, "sourceKind must be url or content");
  const rules = body.rules === undefined
    && body.excludeKeywords === undefined
    && body.includeKeywords === undefined
    && body.removedNames === undefined
    && body.parentNamesByName === undefined
    && body.carrierNames === undefined
    ? parseJsonObject(current.rules_json)
    : importRulesFromBody(body);
  await run(
    env.DB,
    `UPDATE import_sources SET name = ?, source_kind = ?, url = ?, content = ?, name_prefix = ?,
      enabled = ?, rules_json = ?, updated_at = ?
     WHERE id = ?`,
    optionalString(body.name) || current.name,
    sourceKind,
    body.url === null ? null : optionalString(body.url) || current.url,
    body.content === null ? null : optionalString(body.content) || current.content,
    body.namePrefix === null
      ? null
      : optionalString(body.namePrefix) || current.name_prefix,
    body.enabled === undefined ? current.enabled : boolToInt(body.enabled),
    safeJson(rules),
    nowIso(),
    id
  );
  return await first<ImportSourceRow>(env.DB, "SELECT * FROM import_sources WHERE id = ?", id);
}

async function previewImportSource(env: Env, id: string): Promise<{ candidates: ImportCandidate[]; errors: string[] }> {
  const source = await first<ImportSourceRow>(env.DB, "SELECT * FROM import_sources WHERE id = ?", id);
  if (!source) throw new HttpError(404, "import source not found");
  const built = await buildImportCandidates(env, importSourceBody(source));
  return { ...built, candidates: applyImportRules(built.candidates, currentImportRules(parseJsonObject(source.rules_json))) };
}

export async function refreshEnabledImportSources(env: Env): Promise<void> {
  const sources = await all<Pick<ImportSourceRow, "id">>(
    env.DB,
    `SELECT id FROM import_sources
     WHERE enabled = 1
       AND (last_fetched_at IS NULL OR unixepoch(?) - unixepoch(last_fetched_at) >= 240)
     ORDER BY updated_at
     LIMIT 20`,
    nowIso()
  );
  for (const source of sources) {
    try {
      await refreshImportSource(env, source.id, "cron");
    } catch {
      // refreshImportSource records the error on the source row.
    }
  }
}

async function refreshImportSource(env: Env, id: string, mode: "manual" | "cron"): Promise<unknown> {
  const source = await first<ImportSourceRow>(env.DB, "SELECT * FROM import_sources WHERE id = ?", id);
  if (!source) throw new HttpError(404, "import source not found");
  try {
    const preview = await previewImportSource(env, id);
    ensureFreshImportPreview(preview);
    const result = await importProxyNodes(env, {
      candidates: preview.candidates as unknown as JsonValue,
      remark: source.name,
      enabled: true,
      replaceExistingForRemark: true,
      replaceExistingRemarks: replacementRemarksForImportSource(source) as unknown as JsonValue
    });
    await run(
      env.DB,
      "UPDATE import_sources SET rules_json = ?, last_fetched_at = ?, last_imported_at = ?, last_error = NULL, updated_at = ? WHERE id = ?",
      safeJson(currentImportRules(parseJsonObject(source.rules_json))),
      nowIso(),
      nowIso(),
      nowIso(),
      id
    );
    return { ...result, errors: [...preview.errors, ...result.errors] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "refresh failed";
    await run(env.DB, "UPDATE import_sources SET last_error = ?, updated_at = ? WHERE id = ?", message, nowIso(), id);
    if (mode === "cron") return { imported: 0, updated: 0, skipped: 0, errors: [message] };
    throw error;
  }
}

function replacementRemarksForImportSource(source: ImportSourceRow): string[] {
  if (source.source_kind === "url") return parseEndpointValues(source.url);
  return [];
}

function ensureFreshImportPreview(preview: { candidates: ImportCandidate[]; errors: string[] }): void {
  if (preview.errors.length > 0) {
    throw new HttpError(409, `subscription refresh has errors: ${preview.errors.join("; ")}`);
  }
  if (preview.candidates.length === 0) {
    throw new HttpError(409, "subscription refresh returned no proxy nodes");
  }
  const activeCandidates = preview.candidates.filter((item) => !item.removed);
  if (activeCandidates.length === 0) {
    throw new HttpError(409, "subscription refresh returned no enabled proxy nodes after import rules");
  }
}

function importSourceBody(source: ImportSourceRow): JsonRecord {
  if (source.source_kind === "content") {
    return {
      content: source.content || "",
      sourceName: source.name,
      namePrefix: source.name_prefix || ""
    };
  }
  return {
    urls: source.url || "",
    sourceName: source.name,
    namePrefix: source.name_prefix || ""
  };
}

async function upsertProxyNodeByName(env: Env, body: JsonRecord): Promise<{ row: ProxyNodeRow | null; created: boolean }> {
  const name = requiredString(body.name, "name");
  const existing = await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE name = ? ORDER BY updated_at DESC LIMIT 1", name);
  if (existing) {
    return { row: await updateProxyNode(env, existing.id, body), created: false };
  }
  return { row: await createProxyNode(env, body), created: true };
}

async function readImportSources(body: JsonRecord): Promise<Array<{ name: string; content: string }>> {
  const sources: Array<{ name: string; content: string }> = [];
  const content = optionalString(body.content);
  if (content) {
    sources.push({ name: optionalString(body.sourceName) || "pasted-subscription", content });
  }

  const urls = parseEndpointValues(body.url ?? body.urls);
  for (const sourceUrl of urls) {
    const res = await fetch(cacheBustedImportUrl(sourceUrl), {
      headers: {
        "user-agent": "cf-tunnel-control-plane/0.1",
        "cache-control": "no-cache",
        "pragma": "no-cache"
      }
    });
    if (!res.ok) throw new HttpError(400, `failed to fetch ${sourceUrl}: HTTP ${res.status}`);
    sources.push({ name: sourceUrl, content: await res.text() });
  }
  return sources;
}

function cacheBustedImportUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set("_cf_tunnel_refresh", String(Date.now()));
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

async function updateProxyNode(env: Env, id: string, body: JsonRecord): Promise<ProxyNodeRow | null> {
  const current = await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE id = ?", id);
  if (!current) throw new HttpError(404, "proxy node not found");
  const rawConfig = optionalString(body.rawConfig) || current.raw_config;
  const sourceType = optionalString(body.sourceType) || current.source_type;
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
    body.useTunnel === undefined ? current.use_tunnel : boolToInt(body.useTunnel),
    body.selectedTunnelIds === undefined
      && body.selectedTrafficIds === undefined
      && body.selectedTrafficKeys === undefined
      && body.selectedTunnelId === undefined
      ? current.selected_tunnel_id
      : firstSelectedTunnelId(body),
    nowIso(),
    id
  );
  await replaceNodeLinks(env, id, body);
  return await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE id = ?", id);
}

async function replaceNodeLinks(env: Env, nodeId: string, body: JsonRecord): Promise<void> {
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
  if (Array.isArray(body.selectedTunnelIds)
    || Array.isArray(body.selectedTrafficKeys)
    || Array.isArray(body.selectedTrafficIds)
    || body.selectedTunnelId !== undefined) {
    const trafficKeys = selectedTrafficKeysFromBody(body);
    await run(env.DB, "DELETE FROM proxy_node_traffic_bindings WHERE proxy_node_id = ?", nodeId);
    for (const trafficKey of trafficKeys) {
      await run(
        env.DB,
        "INSERT OR REPLACE INTO proxy_node_traffic_bindings (proxy_node_id, traffic_key, enabled) VALUES (?, ?, 1)",
        nodeId,
        trafficKey
      );
    }
  }
  if (Array.isArray(body.selectedSniIds)
    || Array.isArray(body.selectedTrafficIds)) {
    const sniIds = selectedSniIdsFromBody(body);
    await run(env.DB, "DELETE FROM proxy_node_sni_selections WHERE proxy_node_id = ?", nodeId);
    for (const sniId of sniIds) {
      await run(
        env.DB,
        "INSERT OR REPLACE INTO proxy_node_sni_selections (proxy_node_id, sni_id, enabled) VALUES (?, ?, 1)",
        nodeId,
        sniId
      );
    }
  }
}

function selectedTunnelIdsFromBody(body: JsonRecord): string[] {
  const raw = body.selectedTunnelIds;
  const ids = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim())
    : [];
  const traffic = body.selectedTrafficIds;
  if (Array.isArray(traffic)) {
    ids.push(...traffic
      .filter((id): id is string => typeof id === "string" && id.startsWith("tunnel:"))
      .map((id) => id.slice("tunnel:".length).trim())
      .filter(Boolean));
  }
  const single = optionalString(body.selectedTunnelId);
  if (single) ids.unshift(single);
  return Array.from(new Set(ids));
}

function selectedTrafficKeysFromBody(body: JsonRecord): string[] {
  const raw = body.selectedTrafficKeys;
  const keys = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim())
    : [];
  const traffic = body.selectedTrafficIds;
  if (Array.isArray(traffic)) {
    keys.push(...traffic
      .filter((id): id is string => typeof id === "string" && id.startsWith("traffic:"))
      .map((id) => id.slice("traffic:".length).trim())
      .filter(Boolean));
  }
  // Support legacy cached UI clients
  const legacyTunnels = body.selectedTunnelIds;
  if (Array.isArray(legacyTunnels)) {
    keys.push(...legacyTunnels
      .filter((id): id is string => typeof id === "string" && id.startsWith("tunnel:"))
      .map((id) => id.slice("tunnel:".length).trim())
      .filter(Boolean));
  }
  if (typeof body.selectedTunnelId === "string" && body.selectedTunnelId.trim() !== "") {
    if (!keys.includes(body.selectedTunnelId.trim())) keys.push(body.selectedTunnelId.trim());
  }
  return Array.from(new Set(keys));
}

function selectedSniIdsFromBody(body: JsonRecord): string[] {
  const raw = body.selectedSniIds;
  const ids = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim())
    : [];
  const traffic = body.selectedTrafficIds;
  if (Array.isArray(traffic)) {
    ids.push(...traffic
      .filter((id): id is string => typeof id === "string" && id.startsWith("sni:"))
      .map((id) => id.slice("sni:".length).trim())
      .filter(Boolean));
  }
  return Array.from(new Set(ids));
}

function firstSelectedTunnelId(body: JsonRecord): string | null {
  return selectedTunnelIdsFromBody(body)[0] || null;
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
      body.defaultSelected === undefined
        ? existing.default_selected
        : boolToInt(body.defaultSelected),
      intOrNull(body.sortOrder) ?? existing.sort_order,
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
    boolToInt(body.defaultSelected),
    intOrNull(body.sortOrder) || 0,
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
    body.defaultSelected === undefined
      ? current.default_selected
      : boolToInt(body.defaultSelected),
    intOrNull(body.sortOrder) ?? current.sort_order,
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
  const generated = await listGeneratedNodes(env, {
    format: "v2ray",
    group: null,
    includeDisabled: false,
    endpointMode: "selected"
  });
  return groups.map((group) => ({
    ...group,
    ...resolveGroupDerivedIds(derivedNodeIdsFromFilter(String(group.endpoint_filter_json || "{}")), generated)
  }));
}

function resolveGroupDerivedIds(
  savedIds: string[],
  generated: Array<{ id: string; sourceNodeId: string }>
): { derivedNodeIds: string[]; effectiveDerivedNodeIds: string[]; staleDerivedNodeIds: string[] } {
  const currentIds = new Set(generated.map((item) => item.id));
  const exact = savedIds.filter((id) => currentIds.has(id));
  return {
    derivedNodeIds: savedIds,
    effectiveDerivedNodeIds: exact,
    staleDerivedNodeIds: savedIds.filter((id) => !currentIds.has(id))
  };
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
    optionalString(body.endpointMode) || "selected",
    groupEndpointFilterJson(body),
    boolToInt(body.enabled, true),
    intOrNull(body.sortOrder) || 0,
    timestamp,
    timestamp
  );
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
    optionalString(body.endpointMode) || String(current.endpoint_mode),
    body.endpointFilter === undefined
      && body.derivedNodeIds === undefined
      ? String(current.endpoint_filter_json)
      : groupEndpointFilterJson(body),
    body.enabled === undefined ? Number(current.enabled) : boolToInt(body.enabled),
    intOrNull(body.sortOrder) ?? Number(current.sort_order),
    nowIso(),
    id
  );
  return await first(env.DB, "SELECT * FROM groups WHERE id = ?", id);
}

function groupEndpointFilterJson(body: JsonRecord): string {
  const filter = body.endpointFilter || {};
  const record = typeof filter === "object" && filter !== null && !Array.isArray(filter)
    ? { ...(filter as Record<string, unknown>) }
    : {};
  const ids = body.derivedNodeIds;
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

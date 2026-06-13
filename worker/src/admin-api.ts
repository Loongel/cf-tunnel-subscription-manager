import { requireAdmin } from "./auth";
import { all, first, run } from "./db";
import { queueRestartCommand } from "./cron";
import {
  composeFallbackRawConfig,
  parseEndpointValues,
  parseProxySubscriptionContent,
  type ParsedProxyNode
} from "./importers";
import { decodeBase64, inferProtocol } from "./protocols";
import { getSubscriptionToken, rotateSubscriptionToken, subscriptionUrls } from "./settings";
import { listGeneratedNodes, parseSubscriptionOptions, previewSubscription } from "./subscriptions";
import { cleanupStaleTunnels, tunnelTrafficKey, tunnelTrafficLabel } from "./tunnel-registry";
import type { CustomSniRow, Env, ImportSourceRow, JsonRecord, JsonValue, PreferredEndpointRow, ProxyNodeRow, SubscriptionOptions, TunnelRow } from "./types";
import { APP_NAME, APP_VERSION, DB_EXPORT_SCHEMA_VERSION } from "./version";
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
  remark: string | null;
  enabled: number;
  import_key: string | null;
  selectedEndpointIds: string[];
  exclusiveEndpointScopeIds: string[];
  globalEndpointExclusionIds: string[];
  selectedTrafficKeys: string[];
  selectedSniIds: string[];
}

interface ImportSourceContent {
  name: string;
  groupName: string;
  content: string;
}

interface ImportVariant {
  name: string;
  rawConfig: string;
  item: ImportCandidate;
  sourceName: string;
  identity?: {
    importKey: string;
    contentHash: string;
  };
}

const DB_EXPORT_TABLES = [
  "agents",
  "tunnels",
  "commands",
  "proxy_nodes",
  "preferred_endpoints",
  "groups",
  "tunnel_events",
  "settings",
  "custom_snis",
  "import_sources",
  "proxy_node_mutable_state",
  "preferred_endpoint_node_scopes",
  "preferred_endpoint_node_exclusions",
  "proxy_node_endpoint_selections",
  "proxy_node_sni_selections",
  "proxy_node_traffic_bindings"
] as const;

const DB_IMPORT_DELETE_ORDER = [...DB_EXPORT_TABLES].reverse();

type DbExportTable = typeof DB_EXPORT_TABLES[number];

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
  if (request.method === "GET" && path === "/api/admin/maintenance") {
    return json(await maintenanceInfo(env));
  }
  if (request.method === "GET" && path === "/api/admin/maintenance/export") {
    return exportDatabase(env);
  }
  if (request.method === "POST" && path === "/api/admin/maintenance/import") {
    return json(await importDatabase(env, await readJson(request)));
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

async function maintenanceInfo(env: Env): Promise<unknown> {
  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      dbExportSchemaVersion: DB_EXPORT_SCHEMA_VERSION
    },
    database: {
      checkedAt: nowIso(),
      tables: await databaseTableCounts(env)
    }
  };
}

async function databaseTableCounts(env: Env): Promise<Array<{ table: string; rows: number }>> {
  const output: Array<{ table: string; rows: number }> = [];
  for (const table of DB_EXPORT_TABLES) {
    const row = await first<{ total: number }>(env.DB, `SELECT COUNT(*) AS total FROM ${table}`);
    output.push({ table, rows: row?.total || 0 });
  }
  return output;
}

async function exportDatabase(env: Env): Promise<Response> {
  const tables: Record<string, unknown[]> = {};
  for (const table of DB_EXPORT_TABLES) {
    tables[table] = await all(env.DB, `SELECT * FROM ${table}`);
  }
  const payload = {
    kind: "cf-tunnel-subscription-manager-db-export",
    app: APP_NAME,
    appVersion: APP_VERSION,
    schemaVersion: DB_EXPORT_SCHEMA_VERSION,
    exportedAt: nowIso(),
    tables
  };
  const filename = `cf-tunnel-subscription-manager-db-${new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").replace("Z", "Z")}.json`;
  return json(payload, {
    headers: {
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}

async function importDatabase(env: Env, body: JsonRecord): Promise<unknown> {
  if (body.confirm !== "IMPORT_DATABASE") {
    throw new HttpError(400, "confirmation phrase IMPORT_DATABASE is required");
  }
  const tables = body.tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) {
    throw new HttpError(400, "tables object is required");
  }
  const records = tables as Record<string, unknown>;
  for (const table of DB_EXPORT_TABLES) {
    if (!Array.isArray(records[table])) throw new HttpError(400, `table ${table} must be an array`);
  }

  for (const table of DB_IMPORT_DELETE_ORDER) {
    await run(env.DB, `DELETE FROM ${table}`);
  }
  for (const table of DB_EXPORT_TABLES) {
    await importTableRows(env, table, records[table] as unknown[]);
  }
  return {
    importedAt: nowIso(),
    tables: await databaseTableCounts(env)
  };
}

async function importTableRows(env: Env, table: DbExportTable, rows: unknown[]): Promise<void> {
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new HttpError(400, `invalid row in ${table}`);
    }
    const record = row as Record<string, unknown>;
    const columns = Object.keys(record);
    if (columns.length === 0) continue;
    const placeholders = columns.map(() => "?").join(", ");
    const columnSql = columns.map((column) => quoteIdentifier(column)).join(", ");
    await run(
      env.DB,
      `INSERT INTO ${table} (${columnSql}) VALUES (${placeholders})`,
      ...columns.map((column) => record[column])
    );
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
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
    `SELECT n.*,
       COALESCE(s.name, n.name) AS name,
       COALESCE(s.remark, n.remark) AS remark,
       COALESCE(s.enabled, n.enabled) AS enabled
     FROM proxy_nodes n
     LEFT JOIN proxy_node_mutable_state s ON s.import_key = n.import_key
     ORDER BY n.name`
  );
  const selections = await all<{ proxy_node_id: string; endpoint_id: string }>(
    env.DB,
    "SELECT proxy_node_id, endpoint_id FROM proxy_node_endpoint_selections WHERE enabled = 1"
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
    selectedTrafficKeys: trafficBindings.filter((item) => item.proxy_node_id === row.id).map((item) => item.traffic_key),
    selectedSniIds: sniSelections.filter((item) => item.proxy_node_id === row.id).map((item) => item.sni_id),
    selectedTrafficIds: [
      ...trafficBindings.filter((item) => item.proxy_node_id === row.id).map((item) => `traffic:${item.traffic_key}`),
      ...sniSelections.filter((item) => item.proxy_node_id === row.id).map((item) => `sni:${item.sni_id}`)
    ]
  }));
}

async function createProxyNode(env: Env, body: JsonRecord): Promise<ProxyNodeRow | null> {
  const id = optionalString(body.id) || makeId("node");
  const name = requiredString(body.name, "name");
  const rawConfig = requiredString(body.rawConfig, "rawConfig");
  const sourceType = optionalString(body.sourceType) || "v2ray_uri";
  const protocol = optionalString(body.protocol) || inferProtocol(rawConfig, sourceType);
  const timestamp = nowIso();
  await run(
    env.DB,
    `INSERT INTO proxy_nodes
      (id, name, remark, source_type, raw_config, import_key, import_source_name, raw_config_hash,
       protocol, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    optionalString(body.remark),
    sourceType,
    rawConfig,
    optionalString(body.importKey),
    optionalString(body.importSourceName),
    optionalString(body.rawConfigHash),
    protocol,
    boolToInt(body.enabled, true),
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
  const seenImportKeys = new Set<string>();
  const variants: ImportVariant[] = [];
  const newIdsByImportKey = new Map<string, string>();
  let skipped = 0;
  let created = 0;
  let updated = 0;
  let deletedOld = 0;
  let deletedRows: DeletedImportedNodeRow[] = [];

  if (body.replaceExistingForRemark === true && remark) {
    deletedRows = await deleteImportedNodesByRemarks(env, replacementRemarks(body, remark));
    deletedOld = deletedRows.length;
  }

  const deletedStateByImportKey = importStateByDeletedImportKey(deletedRows);
  const deletedStateByName = importStateByDeletedName(deletedRows);

  for (const item of activeCandidates) {
    const name = item.name.trim();
    if (!name) {
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

    const itemVariants = validCarriers.length > 0
      ? validCarriers.map((carrier) => ({
        name: importedCarrierVariantName(name, displayNameForImportCandidate(carrier, deletedStateByImportKey)),
        rawConfig: composeFallbackRawConfig(item.rawConfig, item.sourceType, carrier.rawConfig, carrier.sourceType),
        item,
        sourceName: item.sourceName
      }))
      : [{ name, rawConfig: item.rawConfig, item, sourceName: item.sourceName }];
    variants.push(...itemVariants);
  }

  for (const variant of variants) {
    const identity = await importIdentity(remark || variant.item.sourceGroup || variant.item.sourceName, variant.rawConfig, variant.item.sourceType);
    if (seenImportKeys.has(identity.importKey)) {
      skipped += 1;
      continue;
    }
    seenImportKeys.add(identity.importKey);
    variant.identity = identity;
  }

  disambiguateImportVariantNames(variants.filter((variant) => variant.identity));

  for (const variant of variants) {
    if (!variant.identity) continue;
    const item = variant.item;
    try {
      const stableId = await stableImportedNodeId(variant.identity.importKey);
      const restoredState = deletedStateByImportKey.get(variant.identity.importKey)
        || deletedStateByName.get(variant.name);
      const restoredEndpointIds = restoredState?.selectedEndpointIds || [];
      newIdsByImportKey.set(variant.identity.importKey, stableId);
      const payload = {
        name: restoredState?.name || variant.name,
        remark: restoredState?.remark ?? (remark || item.sourceName),
        rawConfig: variant.rawConfig,
        sourceType: item.sourceType,
        importKey: variant.identity.importKey,
        importSourceName: remark || item.sourceGroup || item.sourceName,
        rawConfigHash: variant.identity.contentHash,
        protocol: item.protocol,
        enabled: restoredState?.enabled ?? (body.enabled === undefined ? true : body.enabled),
        useTunnel: (restoredState?.selectedTrafficKeys.length || restoredState?.selectedSniIds.length) ? true : false,
        ...(restoredEndpointIds.length > 0 ? { selectedEndpointIds: restoredEndpointIds as unknown as JsonValue } : {}),
        ...((restoredState?.selectedTrafficKeys || []).length > 0 ? { selectedTrafficKeys: restoredState?.selectedTrafficKeys as unknown as JsonValue } : {}),
        ...((restoredState?.selectedSniIds || []).length > 0 ? { selectedSniIds: restoredState?.selectedSniIds as unknown as JsonValue } : {}),
        id: stableId
      };
      const result = await upsertImportedProxyNode(env, payload);
      if (restoredState) {
        await upsertProxyNodeMutableState(env, variant.identity.importKey, {
          name: restoredState.name,
          remark: restoredState.remark,
          enabled: restoredState.enabled
        });
      }
      imported.push(result.row);
      if (result.created) created += 1;
      else updated += 1;
    } catch (error) {
      skipped += 1;
      errors.push(`${variant.name}: ${error instanceof Error ? error.message : "import failed"}`);
    }
  }

  if (deletedRows.length > 0 && newIdsByImportKey.size > 0) {
    await migrateGroupDerivedNodeIds(env, deletedRows, newIdsByImportKey);
    await migrateExclusiveEndpointScopes(env, deletedRows, newIdsByImportKey);
    await migrateGlobalEndpointExclusions(env, deletedRows, newIdsByImportKey);
  }

  return { imported: created, updated, skipped, deletedOld, proxyNodes: imported, errors };
}

function importedCarrierVariantName(childName: string, carrierName: string): string {
  return `${childName.trim()} <${carrierName.trim()}>`;
}

function disambiguateImportVariantNames(variants: ImportVariant[]): void {
  const byName = new Map<string, ImportVariant[]>();
  for (const variant of variants) {
    const items = byName.get(variant.name) || [];
    items.push(variant);
    byName.set(variant.name, items);
  }
  for (const items of byName.values()) {
    if (items.length <= 1) continue;
    const seen = new Set<string>();
    for (const item of items) {
      const suffix = item.identity ? item.identity.contentHash.slice(0, 6) : "";
      const sourceLabel = compactImportSourceLabel(item.sourceName);
      let nextName = sourceLabel ? `${sourceLabel} ${item.name}` : item.name;
      if (seen.has(nextName) && suffix) {
        nextName = sourceLabel ? `${sourceLabel} ${item.name} #${suffix}` : `${item.name} #${suffix}`;
      }
      while (seen.has(nextName) && item.identity) {
        const longSuffix = item.identity.contentHash.slice(0, 10);
        nextName = sourceLabel ? `${sourceLabel} ${item.name} #${longSuffix}` : `${item.name} #${longSuffix}`;
      }
      item.name = nextName;
      seen.add(nextName);
    }
  }
}

function compactImportSourceLabel(sourceName: string): string {
  try {
    const url = new URL(sourceName);
    const segments = url.pathname.split("/").map((item) => item.trim()).filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    return (lastSegment || url.hostname).replace(/\.(txt|list|conf|json)$/i, "").slice(0, 32);
  } catch {
    return sourceName.length > 32 ? sourceName.slice(0, 32) : sourceName;
  }
}

function replacementRemarks(body: JsonRecord, remark: string): string[] {
  return Array.from(new Set([remark, ...parseEndpointValues(body.replaceExistingRemarks)]));
}

async function deleteImportedNodesByRemarks(env: Env, remarks: string[]): Promise<DeletedImportedNodeRow[]> {
  if (remarks.length === 0) return [];
  const placeholders = remarks.map(() => "?").join(", ");
  const rows = await all<{ id: string; name: string; remark: string | null; enabled: number; import_key: string | null }>(
    env.DB,
    `SELECT n.id,
       COALESCE(s.name, n.name) AS name,
       COALESCE(s.remark, n.remark) AS remark,
       COALESCE(s.enabled, n.enabled) AS enabled,
       n.import_key
     FROM proxy_nodes n
     LEFT JOIN proxy_node_mutable_state s ON s.import_key = n.import_key
     WHERE n.remark IN (${placeholders})
        OR n.import_source_name IN (${placeholders})`,
    ...remarks,
    ...remarks
  );
  const selectedEndpointIdsByNodeId = await selectedNodeScopedEndpointIds(env, rows.map((row) => row.id));
  const exclusiveEndpointScopeIdsByNodeId = await exclusiveEndpointScopeIds(env, rows.map((row) => row.id));
  const globalEndpointExclusionIdsByNodeId = await globalEndpointExclusionIds(env, rows.map((row) => row.id));
  const trafficKeysByNodeId = await selectedTrafficKeysByNodeId(env, rows.map((row) => row.id));
  const sniIdsByNodeId = await selectedSniIdsByNodeId(env, rows.map((row) => row.id));
  await run(
    env.DB,
    `DELETE FROM proxy_nodes
     WHERE remark IN (${placeholders})
        OR import_source_name IN (${placeholders})`,
    ...remarks,
    ...remarks
  );
  return rows.map((row) => ({
    ...row,
    selectedEndpointIds: selectedEndpointIdsByNodeId.get(row.id) || [],
    exclusiveEndpointScopeIds: exclusiveEndpointScopeIdsByNodeId.get(row.id) || [],
    globalEndpointExclusionIds: globalEndpointExclusionIdsByNodeId.get(row.id) || [],
    selectedTrafficKeys: trafficKeysByNodeId.get(row.id) || [],
    selectedSniIds: sniIdsByNodeId.get(row.id) || []
  }));
}

async function exclusiveEndpointScopeIds(env: Env, nodeIds: string[]): Promise<Map<string, string[]>> {
  const output = new Map<string, string[]>();
  if (nodeIds.length === 0) return output;
  const placeholders = nodeIds.map(() => "?").join(", ");
  const rows = await all<{ proxy_node_id: string; endpoint_id: string }>(
    env.DB,
    `SELECT s.proxy_node_id, s.endpoint_id
     FROM preferred_endpoint_node_scopes s
     JOIN preferred_endpoints e ON e.id = s.endpoint_id
     WHERE e.scope = 'node'
       AND e.selection_mode = 'exclusive'
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

async function globalEndpointExclusionIds(env: Env, nodeIds: string[]): Promise<Map<string, string[]>> {
  const output = new Map<string, string[]>();
  if (nodeIds.length === 0) return output;
  const placeholders = nodeIds.map(() => "?").join(", ");
  const rows = await all<{ proxy_node_id: string; endpoint_id: string }>(
    env.DB,
    `SELECT x.proxy_node_id, x.endpoint_id
     FROM preferred_endpoint_node_exclusions x
     JOIN preferred_endpoints e ON e.id = x.endpoint_id
     WHERE e.scope = 'global'
       AND x.proxy_node_id IN (${placeholders})`,
    ...nodeIds
  );
  for (const row of rows) {
    const ids = output.get(row.proxy_node_id) || [];
    ids.push(row.endpoint_id);
    output.set(row.proxy_node_id, ids);
  }
  return output;
}

async function selectedTrafficKeysByNodeId(env: Env, nodeIds: string[]): Promise<Map<string, string[]>> {
  const output = new Map<string, string[]>();
  if (nodeIds.length === 0) return output;
  const placeholders = nodeIds.map(() => "?").join(", ");
  const rows = await all<{ proxy_node_id: string; traffic_key: string }>(
    env.DB,
    `SELECT proxy_node_id, traffic_key
     FROM proxy_node_traffic_bindings
     WHERE enabled = 1 AND proxy_node_id IN (${placeholders})`,
    ...nodeIds
  );
  for (const row of rows) {
    const keys = output.get(row.proxy_node_id) || [];
    keys.push(row.traffic_key);
    output.set(row.proxy_node_id, keys);
  }
  return output;
}

async function selectedSniIdsByNodeId(env: Env, nodeIds: string[]): Promise<Map<string, string[]>> {
  const output = new Map<string, string[]>();
  if (nodeIds.length === 0) return output;
  const placeholders = nodeIds.map(() => "?").join(", ");
  const rows = await all<{ proxy_node_id: string; sni_id: string }>(
    env.DB,
    `SELECT proxy_node_id, sni_id
     FROM proxy_node_sni_selections
     WHERE enabled = 1 AND proxy_node_id IN (${placeholders})`,
    ...nodeIds
  );
  for (const row of rows) {
    const ids = output.get(row.proxy_node_id) || [];
    ids.push(row.sni_id);
    output.set(row.proxy_node_id, ids);
  }
  return output;
}

function importStateByDeletedImportKey(rows: DeletedImportedNodeRow[]): Map<string, DeletedImportedNodeRow> {
  const output = new Map<string, DeletedImportedNodeRow>();
  for (const row of rows) {
    if (!row.import_key) continue;
    output.set(row.import_key, row);
  }
  return output;
}

function importStateByDeletedName(rows: DeletedImportedNodeRow[]): Map<string, DeletedImportedNodeRow> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const output = new Map<string, DeletedImportedNodeRow>();
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name || counts.get(name) !== 1) continue;
    output.set(name, row);
  }
  return output;
}

function displayNameForImportCandidate(
  candidate: ImportCandidate,
  deletedStateByImportKey: Map<string, DeletedImportedNodeRow>
): string {
  return deletedStateByImportKey.get(candidate.importKey)?.name || candidate.name;
}

async function stableImportedNodeId(importKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(importKey);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `node_${hex.slice(0, 32)}`;
}

async function importIdentity(
  sourceGroup: string,
  rawConfig: string,
  sourceType: string
): Promise<{ importKey: string; contentHash: string }> {
  const normalized = normalizeRawConfigForIdentity(rawConfig, sourceType);
  const contentHash = await sha1Hex(normalized);
  return {
    importKey: `import:v1:${sourceGroup}:${contentHash}`,
    contentHash
  };
}

function normalizeRawConfigForIdentity(rawConfig: string, sourceType: string): string {
  const trimmed = rawConfig.trim();
  if (sourceType === "sing_box_outbound") return normalizeSingBoxIdentityConfig(trimmed);
  if (/^vmess:\/\//i.test(trimmed)) return normalizeVmessIdentityConfig(trimmed);
  return normalizeShareUriIdentityConfig(trimmed);
}

function normalizeShareUriIdentityConfig(rawConfig: string): string {
  try {
    const url = new URL(rawConfig);
    for (const key of VOLATILE_IDENTITY_QUERY_KEYS) {
      url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return rawConfig.trim();
  }
}

function normalizeVmessIdentityConfig(rawConfig: string): string {
  try {
    const parsed = JSON.parse(decodeBase64(rawConfig.replace(/^vmess:\/\//i, ""))) as JsonRecord;
    for (const key of VOLATILE_IDENTITY_RECORD_KEYS) delete parsed[key];
    return `vmess:${stableJsonStringify(parsed)}`;
  } catch {
    return rawConfig.trim();
  }
}

function normalizeSingBoxIdentityConfig(rawConfig: string): string {
  try {
    const parsed = JSON.parse(rawConfig) as JsonRecord;
    normalizeSingBoxIdentityRecord(parsed);
    return stableJsonStringify(parsed);
  } catch {
    return rawConfig.trim();
  }
}

function normalizeSingBoxIdentityRecord(value: JsonValue): void {
  if (Array.isArray(value)) {
    value.forEach(normalizeSingBoxIdentityRecord);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as JsonRecord;
  for (const key of VOLATILE_IDENTITY_RECORD_KEYS) delete record[key];
  for (const child of Object.values(record)) normalizeSingBoxIdentityRecord(child);
}

const VOLATILE_IDENTITY_QUERY_KEYS = ["sid", "spx"];
const VOLATILE_IDENTITY_RECORD_KEYS = ["sid", "spx"];

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => {
      const item = (value as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${stableJsonStringify(item)}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function migrateGroupDerivedNodeIds(
  env: Env,
  deletedRows: Array<{ id: string; import_key: string | null }>,
  newIdsByImportKey: Map<string, string>
): Promise<void> {
  const oldToNewId = new Map<string, string>();
  for (const row of deletedRows) {
    if (!row.import_key) continue;
    const newId = newIdsByImportKey.get(row.import_key);
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

async function migrateExclusiveEndpointScopes(
  env: Env,
  deletedRows: DeletedImportedNodeRow[],
  newIdsByImportKey: Map<string, string>
): Promise<void> {
  for (const row of deletedRows) {
    if (!row.import_key || row.exclusiveEndpointScopeIds.length === 0) continue;
    const newId = newIdsByImportKey.get(row.import_key);
    if (!newId) continue;
    for (const endpointId of row.exclusiveEndpointScopeIds) {
      await run(
        env.DB,
        "INSERT OR IGNORE INTO preferred_endpoint_node_scopes (endpoint_id, proxy_node_id) VALUES (?, ?)",
        endpointId,
        newId
      );
      await run(
        env.DB,
        "INSERT OR REPLACE INTO proxy_node_endpoint_selections (proxy_node_id, endpoint_id, enabled) VALUES (?, ?, 1)",
        newId,
        endpointId
      );
    }
  }
}

async function migrateGlobalEndpointExclusions(
  env: Env,
  deletedRows: DeletedImportedNodeRow[],
  newIdsByImportKey: Map<string, string>
): Promise<void> {
  for (const row of deletedRows) {
    if (!row.import_key || row.globalEndpointExclusionIds.length === 0) continue;
    const newId = newIdsByImportKey.get(row.import_key);
    if (!newId) continue;
    for (const endpointId of row.globalEndpointExclusionIds) {
      await run(
        env.DB,
        "INSERT OR IGNORE INTO preferred_endpoint_node_exclusions (endpoint_id, proxy_node_id) VALUES (?, ?)",
        endpointId,
        newId
      );
    }
  }
}

export const __adminApiTestHooks = {
  importProxyNodes,
  normalizeImportRulesForCandidates
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
  originalName: string;
  sourceName: string;
  sourceGroup: string;
  rawConfig: string;
  importKey: string;
  contentHash: string;
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
  const existing = await all<{ import_key: string | null }>(env.DB, "SELECT import_key FROM proxy_nodes WHERE import_key IS NOT NULL");
  const existingImportKeys = new Set(existing.map((row) => row.import_key).filter((key): key is string => Boolean(key)));
  const candidates: ImportCandidate[] = [];
  const errors: string[] = [];
  const seenImportKeys = new Set<string>();

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

    for (let itemIndex = 0; itemIndex < parsed.length; itemIndex += 1) {
      const item = parsed[itemIndex];
      const name = namePrefix ? `${namePrefix} ${item.name}` : item.name;
      const identity = await importIdentity(source.groupName, item.rawConfig, item.sourceType);
      if (seenImportKeys.has(identity.importKey)) continue;
      seenImportKeys.add(identity.importKey);
      candidates.push({
        id: `candidate_${sourceIndex}_${itemIndex}`,
        name,
        originalName: name,
        sourceName: source.name,
        sourceGroup: source.groupName,
        rawConfig: item.rawConfig,
        importKey: identity.importKey,
        contentHash: identity.contentHash,
        sourceType: item.sourceType,
        protocol: item.protocol,
        server: item.server,
        port: item.port,
        sni: item.sni,
        transport: item.transport,
        tls: item.tls,
        duplicate: existingImportKeys.has(identity.importKey)
      });
    }
  }

  applySavedImportDisplayNames(candidates, currentImportRules(isRecord(body.rules) ? body.rules as JsonRecord : {}));
  return { candidates, errors };
}

function applySavedImportDisplayNames(candidates: ImportCandidate[], rules: JsonRecord): void {
  const displayNamesByKey = isRecord(rules.displayNamesByKey) ? rules.displayNamesByKey as JsonRecord : {};
  for (const candidate of candidates) {
    const savedName = optionalString(displayNamesByKey[candidate.importKey]);
    if (savedName) candidate.name = savedName;
  }
}

function applyImportRules(candidates: ImportCandidate[], rules: JsonRecord): ImportCandidate[] {
  const excludeKeywords = stringArray(rules.excludeKeywords).map((item) => item.toLowerCase());
  const includeKeywords = stringArray(rules.includeKeywords).map((item) => item.toLowerCase());
  const removedKeys = new Set(stringArray(rules.removedKeys));
  const carrierKeys = new Set(stringArray(rules.carrierKeys));
  const parentKeysByKey = isRecord(rules.parentKeysByKey)
    ? rules.parentKeysByKey as JsonRecord
    : {};
  const displayNamesByKey = isRecord(rules.displayNamesByKey) ? rules.displayNamesByKey as JsonRecord : {};
  const byImportKey = new Map(candidates.map((item) => [item.importKey, item]));

  for (const item of candidates) {
    const displayName = optionalString(displayNamesByKey[item.importKey]);
    if (displayName) item.name = displayName;
    const haystack = [item.name, item.protocol, item.server, item.sni, item.transport, item.sourceName].filter(Boolean).join(" ").toLowerCase();
    const includeMatched = includeKeywords.length === 0 || includeKeywords.some((keyword) => haystack.includes(keyword));
    const excludeMatched = excludeKeywords.some((keyword) => haystack.includes(keyword));
    item.removed = removedKeys.has(item.importKey) || !includeMatched || excludeMatched;
    item.asTlsCarrier = carrierKeys.has(item.importKey);
  }

  for (const item of candidates) {
    const parentKeys = stringArray(parentKeysByKey[item.importKey]);
    const parents = Array.from(new Set(parentKeys))
      .map((key) => byImportKey.get(key))
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
  const removedKeys = body.removedKeys ?? inputRules.removedKeys;
  if (Array.isArray(removedKeys)) {
    rules.removedKeys = stringArray(removedKeys);
  }
  const parentKeysByKey = body.parentKeysByKey ?? inputRules.parentKeysByKey;
  if (isRecord(parentKeysByKey)) {
    rules.parentKeysByKey = parentKeysByKey;
  }
  const carrierKeys = body.carrierKeys ?? inputRules.carrierKeys;
  if (Array.isArray(carrierKeys)) {
    rules.carrierKeys = stringArray(carrierKeys);
  }
  const displayNamesByKey = body.displayNamesByKey ?? inputRules.displayNamesByKey;
  if (isRecord(displayNamesByKey)) {
    const output: JsonRecord = {};
    for (const [key, value] of Object.entries(displayNamesByKey)) {
      if (typeof value === "string" && value.trim()) output[key] = value.trim();
    }
    rules.displayNamesByKey = output;
  }
  return rules;
}

function currentImportRules(rules: JsonRecord): JsonRecord {
  return importRulesFromBody({ rules });
}

async function normalizeImportRulesForCandidates(
  env: Env,
  candidates: ImportCandidate[],
  rules: JsonRecord
): Promise<JsonRecord> {
  const candidateKeys = new Set(candidates.map((item) => item.importKey).filter(Boolean));
  const missingKeys = importRuleKeys(rules).filter((key) => !candidateKeys.has(key));
  if (missingKeys.length === 0) return rules;

  const keyMap = await importRuleKeyMapByMutableName(env, candidates, missingKeys);
  if (keyMap.size === 0) return rules;

  const remapKey = (key: string): string => keyMap.get(key) || key;
  const parentKeysByKey: JsonRecord = {};
  const rawParents = isRecord(rules.parentKeysByKey) ? rules.parentKeysByKey as JsonRecord : {};
  for (const [key, value] of Object.entries(rawParents)) {
    const mappedKey = remapKey(key);
    const mappedParents = uniqueStrings(stringArray(value).map(remapKey));
    if (mappedParents.length > 0) parentKeysByKey[mappedKey] = mappedParents;
  }

  const displayNamesByKey: JsonRecord = {};
  const rawDisplayNames = isRecord(rules.displayNamesByKey) ? rules.displayNamesByKey as JsonRecord : {};
  for (const [key, value] of Object.entries(rawDisplayNames)) {
    if (typeof value === "string" && value.trim()) displayNamesByKey[remapKey(key)] = value.trim();
  }

  return {
    ...rules,
    removedKeys: uniqueStrings(stringArray(rules.removedKeys).map(remapKey)),
    carrierKeys: uniqueStrings(stringArray(rules.carrierKeys).map(remapKey)),
    parentKeysByKey,
    displayNamesByKey
  };
}

function importRuleKeys(rules: JsonRecord): string[] {
  const keys: string[] = [
    ...stringArray(rules.removedKeys),
    ...stringArray(rules.carrierKeys)
  ];
  const parentKeysByKey = isRecord(rules.parentKeysByKey) ? rules.parentKeysByKey as JsonRecord : {};
  for (const [key, value] of Object.entries(parentKeysByKey)) {
    keys.push(key, ...stringArray(value));
  }
  const displayNamesByKey = isRecord(rules.displayNamesByKey) ? rules.displayNamesByKey as JsonRecord : {};
  keys.push(...Object.keys(displayNamesByKey));
  return uniqueStrings(keys);
}

async function importRuleKeyMapByMutableName(
  env: Env,
  candidates: ImportCandidate[],
  missingKeys: string[]
): Promise<Map<string, string>> {
  const placeholders = missingKeys.map(() => "?").join(", ");
  const rows = await all<{ import_key: string; name: string | null }>(
    env.DB,
    `SELECT import_key, name
     FROM proxy_node_mutable_state
     WHERE import_key IN (${placeholders})`,
    ...missingKeys
  );
  if (rows.length === 0) return new Map();

  const candidatesByName = uniqueImportCandidatesByName(candidates);
  const output = new Map<string, string>();
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;
    const candidate = candidatesByName.get(name);
    if (candidate?.importKey && candidate.importKey !== row.import_key) {
      output.set(row.import_key, candidate.importKey);
    }
  }
  return output;
}

function uniqueImportCandidatesByName(candidates: ImportCandidate[]): Map<string, ImportCandidate> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const name = candidate.name?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const output = new Map<string, ImportCandidate>();
  for (const candidate of candidates) {
    const name = candidate.name?.trim();
    if (!name || counts.get(name) !== 1) continue;
    output.set(name, candidate);
  }
  return output;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
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
      const sourceGroup = optionalString(item.sourceGroup) || optionalString(item.importSourceName) || optionalString(item.sourceName) || "import";
      const importKey = optionalString(item.importKey) || "";
      const contentHash = optionalString(item.contentHash) || optionalString(item.rawConfigHash) || "";
      return {
        id: optionalString(item.id) || `candidate_${index}`,
        name: requiredString(item.name, "candidate.name"),
        originalName: optionalString(item.originalName) || requiredString(item.name, "candidate.name"),
        sourceName: optionalString(item.sourceName) || "import",
        sourceGroup,
        rawConfig,
        importKey,
        contentHash,
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
    && body.removedKeys === undefined
    && body.parentKeysByKey === undefined
    && body.carrierKeys === undefined
    && body.displayNamesByKey === undefined
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

async function previewImportSource(env: Env, id: string): Promise<{ candidates: ImportCandidate[]; errors: string[]; rules: JsonRecord }> {
  const source = await first<ImportSourceRow>(env.DB, "SELECT * FROM import_sources WHERE id = ?", id);
  if (!source) throw new HttpError(404, "import source not found");
  const built = await buildImportCandidates(env, importSourceBody(source));
  const rules = await normalizeImportRulesForCandidates(env, built.candidates, currentImportRules(parseJsonObject(source.rules_json)));
  return { ...built, rules, candidates: applyImportRules(built.candidates, rules) };
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
      safeJson(preview.rules),
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

async function upsertImportedProxyNode(env: Env, body: JsonRecord): Promise<{ row: ProxyNodeRow | null; created: boolean }> {
  const importKey = requiredString(body.importKey, "importKey");
  const existing = await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE import_key = ? ORDER BY updated_at DESC LIMIT 1", importKey);
  if (existing) {
    return { row: await updateProxyNode(env, existing.id, body), created: false };
  }
  return { row: await createProxyNode(env, body), created: true };
}

async function readImportSources(body: JsonRecord): Promise<ImportSourceContent[]> {
  const sources: ImportSourceContent[] = [];
  const groupName = optionalString(body.sourceName) || optionalString(body.remark) || "import";
  const content = optionalString(body.content);
  if (content) {
    sources.push({ name: optionalString(body.sourceName) || "pasted-subscription", groupName, content });
  }

  const urls = parseEndpointValues(body.url ?? body.urls);
  for (const sourceUrl of urls) {
    const res = await fetch(cacheBustedImportUrl(sourceUrl), {
      headers: importSourceFetchHeaders(sourceUrl)
    });
    if (!res.ok) throw new HttpError(400, `failed to fetch ${sourceUrl}: HTTP ${res.status}`);
    sources.push({ name: sourceUrl, groupName, content: await res.text() });
  }
  return sources;
}

function importSourceFetchHeaders(sourceUrl: string): Headers {
  const headers = new Headers({
    "user-agent": "cf-tunnel-control-plane/0.1",
    "accept": "*/*",
    "cache-control": "no-cache",
    "pragma": "no-cache"
  });
  try {
    const url = new URL(sourceUrl);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", url.protocol.replace(":", "") || "https");
  } catch {
    // Keep the request usable for non-URL inputs that fetch can still handle.
  }
  return headers;
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
  if (current.import_key) {
    await upsertProxyNodeMutableState(env, current.import_key, {
      name: body.name === undefined ? undefined : optionalString(body.name) || current.name,
      remark: body.remark === undefined ? undefined : body.remark === null ? null : optionalString(body.remark) || current.remark,
      enabled: body.enabled === undefined ? undefined : boolToInt(body.enabled)
    });
  }
  const rawConfig = optionalString(body.rawConfig) || current.raw_config;
  const sourceType = optionalString(body.sourceType) || current.source_type;
  await run(
    env.DB,
    `UPDATE proxy_nodes SET
      name = ?, remark = ?, source_type = ?, raw_config = ?,
      import_key = ?, import_source_name = ?, raw_config_hash = ?, protocol = ?,
      enabled = ?, updated_at = ?
     WHERE id = ?`,
    optionalString(body.name) || current.name,
    body.remark === null ? null : optionalString(body.remark) || current.remark,
    sourceType,
    rawConfig,
    body.importKey === undefined ? current.import_key || null : optionalString(body.importKey),
    body.importSourceName === undefined ? current.import_source_name || null : optionalString(body.importSourceName),
    body.rawConfigHash === undefined ? current.raw_config_hash || null : optionalString(body.rawConfigHash),
    optionalString(body.protocol) || inferProtocol(rawConfig, sourceType),
    body.enabled === undefined ? current.enabled : boolToInt(body.enabled),
    nowIso(),
    id
  );
  await replaceNodeLinks(env, id, body);
  return await first<ProxyNodeRow>(env.DB, "SELECT * FROM proxy_nodes WHERE id = ?", id);
}

async function upsertProxyNodeMutableState(
  env: Env,
  importKey: string,
  state: { name?: string | null; remark?: string | null; enabled?: number }
): Promise<void> {
  if (state.name === undefined && state.remark === undefined && state.enabled === undefined) return;
  const current = await first<{ name: string | null; remark: string | null; enabled: number | null }>(
    env.DB,
    "SELECT name, remark, enabled FROM proxy_node_mutable_state WHERE import_key = ?",
    importKey
  );
  const timestamp = nowIso();
  await run(
    env.DB,
    `INSERT INTO proxy_node_mutable_state (import_key, name, remark, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(import_key) DO UPDATE SET
       name = excluded.name,
       remark = excluded.remark,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    importKey,
    state.name === undefined ? current?.name ?? null : state.name,
    state.remark === undefined ? current?.remark ?? null : state.remark,
    state.enabled === undefined ? current?.enabled ?? null : state.enabled,
    timestamp,
    timestamp
  );
}

async function replaceNodeLinks(env: Env, nodeId: string, body: JsonRecord): Promise<void> {
  if (Array.isArray(body.selectedEndpointIds)) {
    await run(
      env.DB,
      `DELETE FROM proxy_node_endpoint_selections
       WHERE proxy_node_id = ?
         AND endpoint_id IN (
           SELECT id FROM preferred_endpoints WHERE selection_mode <> 'exclusive'
         )`,
      nodeId
    );
    for (const endpointId of await additiveNodeScopedEndpointIds(env, body.selectedEndpointIds)) {
      await run(
        env.DB,
        "INSERT OR REPLACE INTO proxy_node_endpoint_selections (proxy_node_id, endpoint_id, enabled) VALUES (?, ?, 1)",
        nodeId,
        endpointId
      );
    }
  }
  if (Array.isArray(body.selectedTrafficKeys)
    || Array.isArray(body.selectedTrafficIds)) {
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

async function additiveNodeScopedEndpointIds(env: Env, values: unknown[]): Promise<string[]> {
  const ids = Array.from(new Set(values
    .filter((id): id is string => typeof id === "string" && id.trim() !== "")
    .map((id) => id.trim())));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await all<{ id: string }>(
    env.DB,
    `SELECT id
     FROM preferred_endpoints
     WHERE id IN (${placeholders})
       AND scope = 'node'
       AND selection_mode <> 'exclusive'`,
    ...ids
  );
  const allowed = new Set(rows.map((row) => row.id));
  return ids.filter((id) => allowed.has(id));
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

async function listPreferredEndpoints(env: Env): Promise<unknown[]> {
  const endpoints = await all<PreferredEndpointRow>(
    env.DB,
    "SELECT * FROM preferred_endpoints ORDER BY sort_order, lower(COALESCE(NULLIF(label, ''), value)), lower(value)"
  );
  const scopes = await all<{ endpoint_id: string; proxy_node_id: string }>(env.DB, "SELECT * FROM preferred_endpoint_node_scopes");
  const exclusions = await all<{ endpoint_id: string; proxy_node_id: string }>(env.DB, "SELECT * FROM preferred_endpoint_node_exclusions");
  const selections = await all<{ endpoint_id: string; proxy_node_id: string }>(
    env.DB,
    "SELECT endpoint_id, proxy_node_id FROM proxy_node_endpoint_selections WHERE enabled = 1"
  );
  return endpoints.map((endpoint) => ({
    ...endpoint,
    proxyNodeIds: scopes.filter((scope) => scope.endpoint_id === endpoint.id).map((scope) => scope.proxy_node_id),
    excludedProxyNodeIds: exclusions.filter((scope) => scope.endpoint_id === endpoint.id).map((scope) => scope.proxy_node_id),
    selectedProxyNodeIds: selections.filter((selection) => selection.endpoint_id === endpoint.id).map((selection) => selection.proxy_node_id)
  }));
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
  const inputType = endpointInputType(requiredString(body.type, "type"));
  const type = endpointStorageType(inputType);
  const discoveryMode = endpointDiscoveryMode(body.discoveryMode, inputType);
  const resolveMode = endpointResolveMode(body.resolveMode, inputType);
  const scope = optionalString(body.scope) || "global";
  if (scope !== "global" && scope !== "node") throw new HttpError(400, "scope must be global or node");
  const selectionMode = endpointSelectionMode(body.selectionMode, scope);
  const timestamp = nowIso();
  const existing = await first<PreferredEndpointRow>(
    env.DB,
    "SELECT * FROM preferred_endpoints WHERE type = ? AND value = ? AND scope = ? AND selection_mode = ?",
    type,
    value,
    scope,
    selectionMode
  );
  if (existing) {
    await run(
      env.DB,
      `UPDATE preferred_endpoints SET
        label = ?, port = ?, resolve_mode = ?, discovery_mode = ?, selection_mode = ?, enabled = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
      body.label === undefined ? existing.label : optionalString(body.label),
      endpointPortForDiscovery(discoveryMode, body.port ?? body.endpointPort, existing.port ?? "443"),
      resolveMode,
      discoveryMode,
      selectionMode,
      body.enabled === undefined ? existing.enabled : boolToInt(body.enabled, true),
      intOrNull(body.sortOrder) ?? existing.sort_order,
      timestamp,
      existing.id
    );
    await replaceEndpointScopes(env, existing.id, body);
    await replaceEndpointExclusions(env, existing.id, body);
    return { row: await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", existing.id) };
  }

  await run(
    env.DB,
    `INSERT INTO preferred_endpoints
      (id, type, value, label, port, resolve_mode, discovery_mode, selection_mode, enabled, scope, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    type,
    value,
    optionalString(body.label),
    endpointPortForDiscovery(discoveryMode, body.port ?? body.endpointPort, "443"),
    resolveMode,
    discoveryMode,
    selectionMode,
    boolToInt(body.enabled, true),
    scope,
    intOrNull(body.sortOrder) || 0,
    timestamp,
    timestamp
  );
  await replaceEndpointScopes(env, id, body);
  await replaceEndpointExclusions(env, id, body);
  return { row: await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", id) };
}

async function updatePreferredEndpoint(env: Env, id: string, body: JsonRecord): Promise<PreferredEndpointRow | null> {
  const current = await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", id);
  if (!current) throw new HttpError(404, "preferred endpoint not found");
  const inputType = body.type === undefined
    ? endpointInputType(current.discovery_mode === "redirect" ? "redirect" : current.type)
    : endpointInputType(body.type);
  const type = endpointStorageType(inputType);
  const scope = optionalString(body.scope) || current.scope;
  const discoveryMode = body.discoveryMode === undefined
    ? endpointDiscoveryMode(current.discovery_mode || "static", inputType)
    : endpointDiscoveryMode(body.discoveryMode, inputType);
  const resolveMode = body.resolveMode === undefined
    ? endpointResolveMode(current.resolve_mode, inputType)
    : endpointResolveMode(body.resolveMode, inputType);
  const selectionMode = endpointSelectionModeForUpdate(body.selectionMode, scope, current);
  await run(
    env.DB,
    `UPDATE preferred_endpoints SET
      type = ?, value = ?, label = ?, port = ?, resolve_mode = ?, discovery_mode = ?, selection_mode = ?, enabled = ?, scope = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
    type,
    optionalString(body.value) || current.value,
    body.label === null ? null : optionalString(body.label) || current.label,
    endpointPortForDiscovery(discoveryMode, body.port ?? body.endpointPort, current.port ?? "443"),
    resolveMode,
    discoveryMode,
    selectionMode,
    body.enabled === undefined ? current.enabled : boolToInt(body.enabled),
    scope,
    intOrNull(body.sortOrder) ?? current.sort_order,
    nowIso(),
    id
  );
  await replaceEndpointScopes(env, id, body);
  await replaceEndpointExclusions(env, id, body);
  return await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", id);
}

function endpointInputType(value: unknown): "ip" | "domain" | "redirect" {
  const type = optionalString(value);
  if (type === "ip" || type === "domain" || type === "redirect") return type;
  throw new HttpError(400, "type must be ip, domain, or redirect");
}

function endpointStorageType(type: "ip" | "domain" | "redirect"): PreferredEndpointRow["type"] {
  return type === "redirect" ? "domain" : type;
}

function endpointDiscoveryMode(value: unknown, type: "ip" | "domain" | "redirect"): NonNullable<PreferredEndpointRow["discovery_mode"]> {
  if (type === "redirect") return "redirect";
  void value;
  return "static";
}

function endpointResolveMode(value: unknown, type: string): PreferredEndpointRow["resolve_mode"] {
  if (type !== "domain") return "none";
  if (value === "ipv4" || value === "ipv6") return value;
  return "none";
}

function endpointPort(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  const port = optionalString(value);
  if (!port) return null;
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new HttpError(400, "port must be blank or a number from 1 to 65535");
  }
  return port;
}

function endpointPortForDiscovery(
  discoveryMode: NonNullable<PreferredEndpointRow["discovery_mode"]>,
  value: unknown,
  fallback: string | null
): string | null {
  if (discoveryMode === "redirect") return null;
  return endpointPort(value, fallback);
}

function endpointSelectionMode(value: unknown, scope: string): PreferredEndpointRow["selection_mode"] {
  if (scope !== "node") return "additive";
  return optionalString(value) === "exclusive" ? "exclusive" : "additive";
}

function endpointSelectionModeForUpdate(
  value: unknown,
  scope: string,
  current: PreferredEndpointRow
): PreferredEndpointRow["selection_mode"] {
  if (scope !== "node") return "additive";
  if (value === undefined && current.scope === "node") return current.selection_mode;
  return endpointSelectionMode(value, scope);
}

async function replaceEndpointScopes(env: Env, endpointId: string, body: JsonRecord): Promise<void> {
  if (!Array.isArray(body.proxyNodeIds)) return;
  const endpoint = await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", endpointId);
  const nodeIds = await existingProxyNodeIds(env, body.proxyNodeIds);
  const existingScopes = await all<{ proxy_node_id: string }>(
    env.DB,
    "SELECT proxy_node_id FROM preferred_endpoint_node_scopes WHERE endpoint_id = ?",
    endpointId
  );
  await run(env.DB, "DELETE FROM preferred_endpoint_node_scopes WHERE endpoint_id = ?", endpointId);
  if (endpoint?.scope === "node") {
    for (const nodeId of nodeIds) {
      await run(
        env.DB,
        "INSERT OR IGNORE INTO preferred_endpoint_node_scopes (endpoint_id, proxy_node_id) VALUES (?, ?)",
        endpointId,
        nodeId
      );
    }
  }
  if (endpoint?.scope === "node" && endpoint.selection_mode === "exclusive") {
    await run(env.DB, "DELETE FROM proxy_node_endpoint_selections WHERE endpoint_id = ?", endpointId);
    for (const nodeId of nodeIds) {
      await run(
        env.DB,
        "INSERT OR REPLACE INTO proxy_node_endpoint_selections (proxy_node_id, endpoint_id, enabled) VALUES (?, ?, 1)",
        nodeId,
        endpointId
      );
    }
  } else if (existingScopes.length > 0) {
    const scopedIds = existingScopes.map((row) => row.proxy_node_id);
    const placeholders = scopedIds.map(() => "?").join(", ");
    await run(
      env.DB,
      `DELETE FROM proxy_node_endpoint_selections
       WHERE endpoint_id = ?
         AND proxy_node_id IN (${placeholders})`,
      endpointId,
      ...scopedIds
    );
  }
}

async function replaceEndpointExclusions(env: Env, endpointId: string, body: JsonRecord): Promise<void> {
  if (!Array.isArray(body.excludedProxyNodeIds)) return;
  const endpoint = await first<PreferredEndpointRow>(env.DB, "SELECT * FROM preferred_endpoints WHERE id = ?", endpointId);
  await run(env.DB, "DELETE FROM preferred_endpoint_node_exclusions WHERE endpoint_id = ?", endpointId);
  if (endpoint?.scope !== "global") return;
  const nodeIds = await existingProxyNodeIds(env, body.excludedProxyNodeIds);
  for (const nodeId of nodeIds) {
    await run(
      env.DB,
      "INSERT OR IGNORE INTO preferred_endpoint_node_exclusions (endpoint_id, proxy_node_id) VALUES (?, ?)",
      endpointId,
      nodeId
    );
  }
}

async function existingProxyNodeIds(env: Env, values: unknown[]): Promise<string[]> {
  const ids = Array.from(new Set(values
    .filter((nodeId): nodeId is string => typeof nodeId === "string" && nodeId.trim() !== "")
    .map((nodeId) => nodeId.trim())));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await all<{ id: string }>(
    env.DB,
    `SELECT id FROM proxy_nodes WHERE id IN (${placeholders})`,
    ...ids
  );
  const existing = new Set(rows.map((row) => row.id));
  return ids.filter((id) => existing.has(id));
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

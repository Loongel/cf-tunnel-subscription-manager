import { all, first } from "./db";
import { encodeBase64, mutateShareUri, toSingBoxOutbound } from "./protocols";
import { tunnelTrafficKey, tunnelTrafficLabel } from "./tunnel-registry";
import type { Env, GeneratedNode, PreferredEndpointRow, ProxyNodeRow, SubscriptionOptions, TunnelRow } from "./types";
import { parseJsonObject } from "./utils";

interface SelectionRow {
  endpoint_id: string;
  proxy_node_id: string;
  enabled: number;
}

interface TunnelSelectionRow {
  proxy_node_id: string;
  traffic_key: string;
  tunnel_id: string;
  public_hostname: string | null;
  public_url: string | null;
  traffic_label?: string;
}

interface TrafficBindingRow {
  proxy_node_id: string;
  traffic_key: string;
}

interface SniSelectionRow {
  proxy_node_id: string;
  sni_id: string;
  hostname: string;
  sni_name: string;
  sni_remark: string | null;
}

interface GroupRow {
  endpoint_mode: SubscriptionOptions["endpointMode"];
  endpoint_filter_json: string;
  enabled: number;
}

interface GroupFilter {
  exists: boolean;
  derivedIds: Set<string>;
}

const VALID_ENDPOINT_MODES = new Set(["selected", "ip", "domain", "all", "none"]);

export function parseSubscriptionOptions(format: string, url: URL): SubscriptionOptions {
  const endpointModeParam = url.searchParams.get("endpointMode");
  const endpointMode = endpointModeParam || "selected";
  return {
    format: format as SubscriptionOptions["format"],
    group: url.searchParams.get("group"),
    includeDisabled: url.searchParams.get("includeDisabled") === "true",
    endpointMode: VALID_ENDPOINT_MODES.has(endpointMode)
      ? (endpointMode as SubscriptionOptions["endpointMode"])
      : "selected",
    endpointModeExplicit: endpointModeParam !== null
  };
}

export async function buildSubscription(env: Env, options: SubscriptionOptions): Promise<{
  content: string;
  generated: GeneratedNode[];
  skipped: GeneratedNode[];
  contentType: string;
}> {
  const generated = await generateNodes(env, options);
  const usable = generated.filter((item) => !item.skipped);
  const skipped = generated.filter((item) => item.skipped);

  if (options.format === "sing-box") {
    const outbounds = usable
      .map((item) => item.outbound)
      .filter(Boolean);
    return {
      content: JSON.stringify({ outbounds }, null, 2),
      generated: usable,
      skipped,
      contentType: "application/json; charset=utf-8"
    };
  }

  const lines = usable
    .map((item) => item.uri)
    .filter((item): item is string => Boolean(item));
  return {
    content: encodeBase64(lines.join("\n")),
    generated: usable,
    skipped,
    contentType: "text/plain; charset=utf-8"
  };
}

export async function previewSubscription(env: Env, options: SubscriptionOptions): Promise<{
  generatedCount: number;
  skippedCount: number;
  protocols: Record<string, number>;
  skipped: Array<{ sourceName: string; protocol: string; reason?: string }>;
}> {
  const result = await buildSubscription(env, options);
  const protocols: Record<string, number> = {};
  for (const node of result.generated) {
    protocols[node.protocol] = (protocols[node.protocol] || 0) + 1;
  }
  return {
    generatedCount: result.generated.length,
    skippedCount: result.skipped.length,
    protocols,
    skipped: result.skipped.map((item) => ({
      sourceName: item.sourceName,
      protocol: item.protocol,
      reason: item.reason
    }))
  };
}

async function loadNodes(env: Env, options: SubscriptionOptions): Promise<ProxyNodeRow[]> {
  const enabledClause = options.includeDisabled ? "" : "AND COALESCE(s.enabled, n.enabled) = 1";
  return await all<ProxyNodeRow>(
    env.DB,
    `SELECT n.*,
       COALESCE(s.name, n.name) AS name,
       COALESCE(s.remark, n.remark) AS remark,
       COALESCE(s.enabled, n.enabled) AS enabled,
       t.public_hostname AS tunnel_public_hostname,
       t.public_url AS tunnel_public_url
     FROM proxy_nodes n
     LEFT JOIN proxy_node_mutable_state s ON s.import_key = n.import_key
     LEFT JOIN tunnels t ON t.id = n.selected_tunnel_id
     WHERE 1 = 1 ${enabledClause}
     ORDER BY n.name`
  );
}

export async function listGeneratedNodes(env: Env, options: SubscriptionOptions): Promise<GeneratedNode[]> {
  return await generateNodes(env, options);
}

async function generateNodes(env: Env, options: SubscriptionOptions): Promise<GeneratedNode[]> {
  const effectiveOptions = await withGroupDefaults(env, options);
  const [nodes, rawEndpoints, selections, trafficBindings, healthyTunnels, sniSelections, groupFilter] = await Promise.all([
    loadNodes(env, effectiveOptions),
    all<PreferredEndpointRow>(
      env.DB,
      "SELECT * FROM preferred_endpoints WHERE enabled = 1 ORDER BY sort_order, value"
    ),
    all<SelectionRow>(env.DB, "SELECT * FROM proxy_node_endpoint_selections WHERE enabled = 1"),
    all<TrafficBindingRow>(
      env.DB,
      "SELECT proxy_node_id, traffic_key FROM proxy_node_traffic_bindings WHERE enabled = 1"
    ),
    all<TunnelRow>(
      env.DB,
      `SELECT * FROM tunnels
       WHERE type = 'quick'
         AND health_status = 'healthy'
         AND public_hostname IS NOT NULL
         AND public_hostname <> ''
         AND target_url IS NOT NULL
         AND target_url <> ''`
    ),
    all<SniSelectionRow>(
      env.DB,
      `SELECT pss.proxy_node_id, pss.sni_id, s.hostname, s.name AS sni_name, s.remark AS sni_remark
       FROM proxy_node_sni_selections pss
       JOIN custom_snis s ON s.id = pss.sni_id
       WHERE pss.enabled = 1 AND s.enabled = 1`
    ),
    loadGroupFilter(env, effectiveOptions.group)
  ]);

  if (groupFilter?.exists === false) return [];
  const endpoints = await resolveEndpointValues(rawEndpoints);

  const selectedByNode = new Map<string, Set<string>>();
  for (const selection of selections) {
    const set = selectedByNode.get(selection.proxy_node_id) || new Set<string>();
    set.add(selection.endpoint_id);
    selectedByNode.set(selection.proxy_node_id, set);
  }

  const latestTunnelByTrafficKey = latestHealthyTunnelsByTrafficKey(healthyTunnels);
  const tunnelsByNode = new Map<string, TunnelSelectionRow[]>();
  for (const binding of trafficBindings) {
    const tunnel = latestTunnelByTrafficKey.get(binding.traffic_key);
    if (!tunnel) continue;
    const rows = tunnelsByNode.get(binding.proxy_node_id) || [];
    rows.push({
      proxy_node_id: binding.proxy_node_id,
      traffic_key: binding.traffic_key,
      tunnel_id: tunnel.id,
      public_hostname: tunnel.public_hostname,
      public_url: tunnel.public_url,
      traffic_label: tunnelTrafficLabel(tunnel)
    });
    tunnelsByNode.set(binding.proxy_node_id, rows);
  }

  const snisByNode = new Map<string, SniSelectionRow[]>();
  for (const selection of sniSelections) {
    const rows = snisByNode.get(selection.proxy_node_id) || [];
    rows.push(selection);
    snisByNode.set(selection.proxy_node_id, rows);
  }

  const output: GeneratedNode[] = [];
  for (const node of nodes) {
    const selected = selectEndpoints(node.id, endpoints, selectedByNode, effectiveOptions.endpointMode);

    const selectedTraffic = selectedTrafficForNode(node, tunnelsByNode, snisByNode);
    if (selectedTraffic.length === 0) {
      if (selected.length === 0) {
        output.push(generateOne(node, null, null, null, null, null, effectiveOptions));
      } else {
        for (const endpoint of selected) {
          output.push(generateOne(node, null, null, null, null, endpoint, effectiveOptions));
        }
      }
      continue;
    }

    for (const traffic of selectedTraffic) {
      const tunnelId = traffic.id === "direct" ? null : traffic.id;
      const tunnelHost = traffic.hostname;
      const trafficLabel = traffic.label || null;
      if (selected.length === 0) {
        output.push(generateOne(node, tunnelId, traffic.sniId || null, tunnelHost, trafficLabel, null, effectiveOptions));
        continue;
      }
      for (const endpoint of selected) {
        output.push(generateOne(node, tunnelId, traffic.sniId || null, tunnelHost, trafficLabel, endpoint, effectiveOptions));
      }
    }
  }
  return filterGeneratedByGroup(output, groupFilter);
}

function selectedTrafficForNode(
  node: ProxyNodeRow,
  tunnelsByNode: Map<string, TunnelSelectionRow[]>,
  snisByNode: Map<string, SniSelectionRow[]>
): Array<{ id: string; sniId?: string; hostname: string | null; label?: string }> {
  const output: Array<{ id: string; sniId?: string; hostname: string | null; label?: string }> = [
    { id: "direct", hostname: null }
  ];
  if (node.use_tunnel) {
    for (const tunnel of selectedTunnelsForNode(node, tunnelsByNode)) {
      output.push({ id: tunnel.traffic_key, hostname: tunnel.public_hostname, label: tunnel.traffic_label });
    }
  }
  for (const sni of snisByNode.get(node.id) || []) {
    output.push({ id: `sni:${sni.sni_id}`, sniId: sni.sni_id, hostname: sni.hostname, label: sni.sni_remark || sni.sni_name });
  }
  return output;
}

function selectedTunnelsForNode(
  node: ProxyNodeRow,
  tunnelsByNode: Map<string, TunnelSelectionRow[]>
): TunnelSelectionRow[] {
  const selected = tunnelsByNode.get(node.id);
  if (selected && selected.length > 0) return selected;
  return [];
}

function latestHealthyTunnelsByTrafficKey(tunnels: TunnelRow[]): Map<string, TunnelRow> {
  const output = new Map<string, TunnelRow>();
  for (const tunnel of tunnels) {
    const key = tunnelTrafficKey(tunnel);
    if (!key) continue;
    const current = output.get(key);
    if (!current || Date.parse(tunnel.updated_at || "") > Date.parse(current.updated_at || "")) {
      output.set(key, tunnel);
    }
  }
  return output;
}

async function withGroupDefaults(env: Env, options: SubscriptionOptions): Promise<SubscriptionOptions> {
  if (!options.group || options.endpointModeExplicit) return options;
  const group = await first<GroupRow>(
    env.DB,
    "SELECT endpoint_mode, endpoint_filter_json, enabled FROM groups WHERE name = ? AND enabled = 1",
    options.group
  );
  if (!group || !VALID_ENDPOINT_MODES.has(group.endpoint_mode)) return options;
  return { ...options, endpointMode: group.endpoint_mode };
}

async function loadGroupFilter(
  env: Env,
  groupName: string | null | undefined
): Promise<GroupFilter | null> {
  if (!groupName) return null;
  const group = await first<GroupRow>(
    env.DB,
    "SELECT endpoint_mode, endpoint_filter_json, enabled FROM groups WHERE name = ? AND enabled = 1",
    groupName
  );
  if (!group) return { exists: false, derivedIds: new Set() };

  const filter = parseJsonObject(group.endpoint_filter_json);
  const derivedIds = Array.isArray(filter.derivedNodeIds)
    ? filter.derivedNodeIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    exists: true,
    derivedIds: new Set(derivedIds)
  };
}

function filterGeneratedByGroup(
  generated: GeneratedNode[],
  groupFilter: GroupFilter | null
): GeneratedNode[] {
  if (!groupFilter) return generated;
  if (groupFilter.exists === false) return [];
  return generated.filter((item) => groupFilter.derivedIds.has(item.id));
}

function selectEndpoints(
  nodeId: string,
  available: PreferredEndpointRow[],
  selectedByNode: Map<string, Set<string>>,
  mode: SubscriptionOptions["endpointMode"]
): PreferredEndpointRow[] {
  if (mode === "none") return [];
  if (mode === "ip" || mode === "domain") {
    return available.filter((endpoint) => endpoint.type === mode);
  }
  if (mode === "all") return available;

  const selected = selectedByNode.get(nodeId);
  const global = available.filter((endpoint) => endpoint.scope === "global");
  if (!selected || selected.size === 0) return global;
  const selectedEndpoints = available.filter((endpoint) => selected.has(endpoint.id));
  const exclusive = selectedEndpoints.filter((endpoint) => endpoint.selection_mode === "exclusive");
  if (exclusive.length > 0) return exclusive;
  return available.filter((endpoint) => endpoint.scope === "global" || selected.has(endpoint.id));
}

async function resolveEndpointValues(endpoints: PreferredEndpointRow[]): Promise<PreferredEndpointRow[]> {
  const cache = new Map<string, Promise<string | null>>();
  return await Promise.all(endpoints.map(async (endpoint) => {
    if (endpoint.type !== "domain" || endpoint.resolve_mode === "none") return endpoint;
    const key = `${endpoint.resolve_mode}:${endpoint.value.toLowerCase()}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = resolveDomain(endpoint.value, endpoint.resolve_mode);
      cache.set(key, pending);
    }
    const resolved = await pending;
    return resolved ? { ...endpoint, value: resolved } : endpoint;
  }));
}

async function resolveDomain(name: string, mode: "ipv4" | "ipv6"): Promise<string | null> {
  const type = mode === "ipv4" ? "A" : "AAAA";
  try {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", name);
    url.searchParams.set("type", type);
    const response = await fetch(url.toString(), { headers: { accept: "application/dns-json" } });
    if (!response.ok) return null;
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    const expectedType = mode === "ipv4" ? 1 : 28;
    const answer = (body.Answer || []).find((item) => item.type === expectedType && typeof item.data === "string");
    return answer?.data || null;
  } catch {
    return null;
  }
}

function generateOne(
  node: ProxyNodeRow,
  tunnelId: string | null,
  sniId: string | null,
  tunnelHost: string | null,
  trafficLabel: string | null,
  endpoint: PreferredEndpointRow | null,
  options: SubscriptionOptions
): GeneratedNode {
  const ctx = { node, tunnelHost, trafficLabel, endpoint, format: options.format };
  const trafficId = sniId ? `sni:${sniId}` : tunnelId || "direct";
  const id = `${node.id}:${trafficId}:${endpoint?.id || "direct"}`;
  const metadata = {
    id,
    tunnelId: tunnelId || undefined,
    sniId: sniId || undefined,
    endpointLabel: endpoint?.label || undefined,
    trafficLabel: trafficLabel || undefined
  };
  if (options.format === "sing-box") {
    return { ...toSingBoxOutbound(node.raw_config, ctx), ...metadata };
  }
  return { ...mutateShareUri(node.raw_config, ctx), ...metadata };
}

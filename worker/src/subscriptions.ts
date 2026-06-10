import { all, first } from "./db";
import { encodeBase64, mutateShareUri, toSingBoxOutbound } from "./protocols";
import type { Env, GeneratedNode, PreferredEndpointRow, ProxyNodeRow, SubscriptionOptions } from "./types";
import { parseJsonObject } from "./utils";

interface SelectionRow {
  endpoint_id: string;
  proxy_node_id: string;
  enabled: number;
}

interface GroupRow {
  endpoint_mode: SubscriptionOptions["endpointMode"];
  endpoint_filter_json: string;
  enabled: number;
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
  const enabledClause = options.includeDisabled ? "" : "AND n.enabled = 1";
  return await all<ProxyNodeRow>(
    env.DB,
    `SELECT n.*, t.public_hostname AS tunnel_public_hostname, t.public_url AS tunnel_public_url
     FROM proxy_nodes n
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
  const [nodes, endpoints, selections, groupFilter] = await Promise.all([
    loadNodes(env, effectiveOptions),
    all<PreferredEndpointRow>(
      env.DB,
      "SELECT * FROM preferred_endpoints WHERE enabled = 1 ORDER BY sort_order, value"
    ),
    all<SelectionRow>(env.DB, "SELECT * FROM proxy_node_endpoint_selections WHERE enabled = 1"),
    loadGroupFilter(env, effectiveOptions.group)
  ]);

  if (groupFilter?.exists === false) return [];

  const selectedByNode = new Map<string, Set<string>>();
  for (const selection of selections) {
    const set = selectedByNode.get(selection.proxy_node_id) || new Set<string>();
    set.add(selection.endpoint_id);
    selectedByNode.set(selection.proxy_node_id, set);
  }

  const output: GeneratedNode[] = [];
  for (const node of nodes) {
    const tunnelHost = node.use_tunnel ? node.tunnel_public_hostname : null;
    const selected = selectEndpoints(node.id, endpoints, selectedByNode, effectiveOptions.endpointMode);

    if (!node.use_tunnel || !tunnelHost) {
      output.push(generateOne(node, null, null, effectiveOptions));
      continue;
    }

    if (selected.length === 0) {
      output.push(generateOne(node, tunnelHost, null, effectiveOptions));
      continue;
    }

    for (const endpoint of selected) {
      output.push(generateOne(node, tunnelHost, endpoint, effectiveOptions));
    }
  }
  return filterGeneratedByGroup(output, groupFilter);
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
): Promise<{ exists: boolean; derivedIds?: Set<string>; legacyNodeIds?: Set<string> } | null> {
  if (!groupName) return null;
  const group = await first<GroupRow>(
    env.DB,
    "SELECT endpoint_mode, endpoint_filter_json, enabled FROM groups WHERE name = ? AND enabled = 1",
    groupName
  );
  if (!group) return { exists: false };

  const filter = parseJsonObject(group.endpoint_filter_json);
  if (Array.isArray(filter.derivedNodeIds)) {
    return {
      exists: true,
      derivedIds: new Set(filter.derivedNodeIds.filter((id): id is string => typeof id === "string"))
    };
  }

  const legacyRows = await all<{ proxy_node_id: string }>(
    env.DB,
    `SELECT gm.proxy_node_id
     FROM group_members gm
     JOIN groups g ON g.id = gm.group_id
     WHERE g.name = ? AND g.enabled = 1`,
    groupName
  );
  return {
    exists: true,
    legacyNodeIds: new Set(legacyRows.map((row) => row.proxy_node_id))
  };
}

function filterGeneratedByGroup(
  generated: GeneratedNode[],
  groupFilter: { exists: boolean; derivedIds?: Set<string>; legacyNodeIds?: Set<string> } | null
): GeneratedNode[] {
  if (!groupFilter) return generated;
  if (groupFilter.exists === false) return [];
  if (groupFilter.derivedIds) return generated.filter((item) => groupFilter.derivedIds?.has(item.id));
  if (groupFilter.legacyNodeIds) return generated.filter((item) => groupFilter.legacyNodeIds?.has(item.sourceNodeId));
  return [];
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
  return available.filter((endpoint) => endpoint.scope === "global" || selected.has(endpoint.id));
}

function generateOne(
  node: ProxyNodeRow,
  tunnelHost: string | null,
  endpoint: PreferredEndpointRow | null,
  options: SubscriptionOptions
): GeneratedNode {
  const ctx = { node, tunnelHost, endpoint, format: options.format };
  if (options.format === "sing-box") {
    return toSingBoxOutbound(node.raw_config, ctx);
  }
  return mutateShareUri(node.raw_config, ctx);
}

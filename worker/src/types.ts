export interface Env {
  DB: D1Database;
  SUB_CACHE?: KVNamespace;
  ADMIN_TOKEN: string;
  AGENT_TOKEN: string;
  SUBSCRIPTION_TOKEN: string;
  PUBLIC_BASE_URL?: string;
  SUBCONVERTER_URL?: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export interface AgentRegisterBody {
  agentId: string;
  instanceId?: string;
  hostname?: string;
  swarmNodeName?: string;
  stackName?: string;
  serviceName?: string;
  imageVersion?: string;
  cloudflaredVersion?: string;
  capabilities?: JsonRecord;
}

export interface TunnelStatusBody {
  tunnelKey: string;
  type: "fixed" | "quick";
  targetUrl?: string;
  publicUrl?: string;
  publicHostname?: string;
  metricsPort?: number;
  status?: string;
  processStatus?: string;
  health?: string;
  healthStatus?: string;
  lastError?: string | null;
  restartCount?: number;
  startedAt?: string;
  lastSeenAt?: string;
}

export interface AgentHeartbeatBody extends AgentRegisterBody {
  tunnels?: TunnelStatusBody[];
}

export interface TunnelRow {
  id: string;
  agent_id: string;
  tunnel_key: string;
  type: "fixed" | "quick";
  target_url: string | null;
  public_url: string | null;
  public_hostname: string | null;
  swarm_node_name: string | null;
  remark: string | null;
  metrics_port: number | null;
  process_status: string;
  health_status: string;
  last_probe_status: string | null;
  failure_count: number;
  restart_count: number;
  last_error: string | null;
  started_at: string | null;
  last_seen_at: string | null;
  last_url_changed_at: string | null;
  last_restart_command_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProxyNodeRow {
  id: string;
  name: string;
  remark: string | null;
  source_type: string;
  raw_config: string;
  import_key?: string | null;
  import_source_name?: string | null;
  raw_config_hash?: string | null;
  protocol: string;
  enabled: number;
  use_tunnel: number;
  selected_tunnel_id: string | null;
  created_at: string;
  updated_at: string;
  tunnel_public_hostname?: string | null;
  tunnel_public_url?: string | null;
}

export interface PreferredEndpointRow {
  id: string;
  type: "ip" | "domain";
  value: string;
  label: string | null;
  resolve_mode: "none" | "ipv4" | "ipv6";
  selection_mode: "additive" | "exclusive";
  enabled: number;
  scope: "global" | "node";
  default_selected: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CustomSniRow {
  id: string;
  name: string;
  hostname: string;
  remark: string | null;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ImportSourceRow {
  id: string;
  name: string;
  source_kind: "url" | "content";
  url: string | null;
  content: string | null;
  name_prefix: string | null;
  enabled: number;
  rules_json: string;
  last_fetched_at: string | null;
  last_imported_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionOptions {
  format: "v2ray" | "passwall2" | "sing-box";
  group?: string | null;
  includeDisabled: boolean;
  endpointMode: "selected" | "ip" | "domain" | "all" | "none";
  endpointModeExplicit?: boolean;
}

export interface GeneratedNode {
  id: string;
  sourceNodeId: string;
  sourceName: string;
  tunnelId?: string;
  sniId?: string;
  endpointId?: string;
  endpointValue?: string;
  endpointLabel?: string;
  endpointType?: "ip" | "domain";
  tunnelHost?: string;
  trafficLabel?: string;
  protocol: string;
  uri?: string;
  outbound?: JsonRecord;
  skipped?: boolean;
  reason?: string;
}

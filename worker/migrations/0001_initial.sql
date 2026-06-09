PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  instance_id TEXT,
  hostname TEXT,
  swarm_node_name TEXT,
  stack_name TEXT,
  service_name TEXT,
  image_version TEXT,
  cloudflared_version TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tunnels (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tunnel_key TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fixed', 'quick')),
  target_url TEXT,
  public_url TEXT,
  public_hostname TEXT,
  swarm_node_name TEXT,
  metrics_port INTEGER,
  process_status TEXT NOT NULL DEFAULT 'starting',
  health_status TEXT NOT NULL DEFAULT 'unknown',
  last_probe_status TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  restart_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at TEXT,
  last_seen_at TEXT,
  last_url_changed_at TEXT,
  last_restart_command_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_id, tunnel_key)
);

CREATE INDEX IF NOT EXISTS idx_tunnels_agent_id ON tunnels(agent_id);
CREATE INDEX IF NOT EXISTS idx_tunnels_health ON tunnels(health_status);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tunnel_id TEXT REFERENCES tunnels(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('restart_tunnel', 'refresh_status', 'restart_agent')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'expired')),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  finished_at TEXT,
  expires_at TEXT,
  result_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_commands_agent_status ON commands(agent_id, status, created_at);

CREATE TABLE IF NOT EXISTS proxy_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  remark TEXT,
  source_type TEXT NOT NULL DEFAULT 'v2ray_uri',
  raw_config TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'unknown',
  enabled INTEGER NOT NULL DEFAULT 1,
  use_tunnel INTEGER NOT NULL DEFAULT 0,
  selected_tunnel_id TEXT REFERENCES tunnels(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proxy_nodes_enabled ON proxy_nodes(enabled);

CREATE TABLE IF NOT EXISTS preferred_endpoints (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('ip', 'domain')),
  value TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'node')),
  default_selected INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (type, value, scope)
);

CREATE TABLE IF NOT EXISTS preferred_endpoint_node_scopes (
  endpoint_id TEXT NOT NULL REFERENCES preferred_endpoints(id) ON DELETE CASCADE,
  proxy_node_id TEXT NOT NULL REFERENCES proxy_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (endpoint_id, proxy_node_id)
);

CREATE TABLE IF NOT EXISTS proxy_node_endpoint_selections (
  proxy_node_id TEXT NOT NULL REFERENCES proxy_nodes(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES preferred_endpoints(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (proxy_node_id, endpoint_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  remark TEXT,
  endpoint_mode TEXT NOT NULL DEFAULT 'selected',
  endpoint_filter_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  proxy_node_id TEXT NOT NULL REFERENCES proxy_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, proxy_node_id)
);

CREATE TABLE IF NOT EXISTS tunnel_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  tunnel_id TEXT REFERENCES tunnels(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_created ON tunnel_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_tunnel ON tunnel_events(tunnel_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

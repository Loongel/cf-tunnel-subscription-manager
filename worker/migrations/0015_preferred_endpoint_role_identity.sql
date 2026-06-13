PRAGMA foreign_keys = OFF;

CREATE TEMP TABLE preferred_endpoint_node_scopes_backup AS
SELECT endpoint_id, proxy_node_id FROM preferred_endpoint_node_scopes;

CREATE TEMP TABLE preferred_endpoint_node_exclusions_backup AS
SELECT endpoint_id, proxy_node_id FROM preferred_endpoint_node_exclusions;

CREATE TEMP TABLE proxy_node_endpoint_selections_backup AS
SELECT proxy_node_id, endpoint_id, enabled FROM proxy_node_endpoint_selections;

CREATE TABLE preferred_endpoints_next (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('ip', 'domain')),
  value TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'node')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolve_mode TEXT NOT NULL DEFAULT 'none' CHECK (resolve_mode IN ('none', 'ipv4', 'ipv6')),
  selection_mode TEXT NOT NULL DEFAULT 'additive' CHECK (selection_mode IN ('additive', 'exclusive')),
  discovery_mode TEXT NOT NULL DEFAULT 'static' CHECK (discovery_mode IN ('static', 'redirect')),
  port TEXT DEFAULT '443',
  UNIQUE (type, value, scope, selection_mode)
);

INSERT INTO preferred_endpoints_next
  (id, type, value, label, enabled, scope, sort_order, created_at, updated_at, resolve_mode, selection_mode, discovery_mode, port)
SELECT
  id,
  type,
  value,
  label,
  enabled,
  scope,
  sort_order,
  created_at,
  updated_at,
  resolve_mode,
  selection_mode,
  discovery_mode,
  port
FROM preferred_endpoints;

DROP TABLE preferred_endpoints;
ALTER TABLE preferred_endpoints_next RENAME TO preferred_endpoints;

INSERT OR IGNORE INTO preferred_endpoint_node_scopes (endpoint_id, proxy_node_id)
SELECT s.endpoint_id, s.proxy_node_id
FROM preferred_endpoint_node_scopes_backup s
JOIN preferred_endpoints e ON e.id = s.endpoint_id
JOIN proxy_nodes n ON n.id = s.proxy_node_id;

INSERT OR IGNORE INTO preferred_endpoint_node_exclusions (endpoint_id, proxy_node_id)
SELECT x.endpoint_id, x.proxy_node_id
FROM preferred_endpoint_node_exclusions_backup x
JOIN preferred_endpoints e ON e.id = x.endpoint_id
JOIN proxy_nodes n ON n.id = x.proxy_node_id;

INSERT OR REPLACE INTO proxy_node_endpoint_selections (proxy_node_id, endpoint_id, enabled)
SELECT s.proxy_node_id, s.endpoint_id, s.enabled
FROM proxy_node_endpoint_selections_backup s
JOIN proxy_nodes n ON n.id = s.proxy_node_id
JOIN preferred_endpoints e ON e.id = s.endpoint_id;

DROP TABLE preferred_endpoint_node_scopes_backup;
DROP TABLE preferred_endpoint_node_exclusions_backup;
DROP TABLE proxy_node_endpoint_selections_backup;

PRAGMA foreign_keys = ON;

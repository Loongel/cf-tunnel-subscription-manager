PRAGMA foreign_keys = OFF;

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

PRAGMA foreign_keys = ON;

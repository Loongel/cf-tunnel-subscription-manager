PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS custom_snis (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  remark TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proxy_node_sni_selections (
  proxy_node_id TEXT NOT NULL REFERENCES proxy_nodes(id) ON DELETE CASCADE,
  sni_id TEXT NOT NULL REFERENCES custom_snis(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (proxy_node_id, sni_id)
);

CREATE TABLE IF NOT EXISTS import_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL DEFAULT 'url' CHECK (source_kind IN ('url', 'content')),
  url TEXT,
  content TEXT,
  name_prefix TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  rules_json TEXT NOT NULL DEFAULT '{}',
  last_fetched_at TEXT,
  last_imported_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

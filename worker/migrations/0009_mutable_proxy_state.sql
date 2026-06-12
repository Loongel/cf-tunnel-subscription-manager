PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS proxy_node_mutable_state (
  import_key TEXT PRIMARY KEY,
  name TEXT,
  remark TEXT,
  enabled INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS proxy_node_user_overrides;

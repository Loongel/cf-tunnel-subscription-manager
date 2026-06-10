PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS proxy_node_tunnel_selections (
  proxy_node_id TEXT NOT NULL REFERENCES proxy_nodes(id) ON DELETE CASCADE,
  tunnel_id TEXT NOT NULL REFERENCES tunnels(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (proxy_node_id, tunnel_id)
);

INSERT OR IGNORE INTO proxy_node_tunnel_selections (proxy_node_id, tunnel_id, enabled)
SELECT id, selected_tunnel_id, 1
FROM proxy_nodes
WHERE selected_tunnel_id IS NOT NULL AND selected_tunnel_id <> '';

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS proxy_node_traffic_bindings (
  proxy_node_id TEXT NOT NULL REFERENCES proxy_nodes(id) ON DELETE CASCADE,
  traffic_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (proxy_node_id, traffic_key)
);

INSERT OR IGNORE INTO proxy_node_traffic_bindings (proxy_node_id, traffic_key, enabled)
SELECT pts.proxy_node_id,
       'swarm:' || t.swarm_node_name || '|target:' || t.target_url,
       pts.enabled
FROM proxy_node_tunnel_selections pts
JOIN tunnels t ON t.id = pts.tunnel_id
WHERE t.swarm_node_name IS NOT NULL
  AND t.swarm_node_name <> ''
  AND t.target_url IS NOT NULL
  AND t.target_url <> '';

INSERT OR IGNORE INTO proxy_node_traffic_bindings (proxy_node_id, traffic_key, enabled)
SELECT n.id,
       'swarm:' || t.swarm_node_name || '|target:' || t.target_url,
       1
FROM proxy_nodes n
JOIN tunnels t ON t.id = n.selected_tunnel_id
WHERE n.selected_tunnel_id IS NOT NULL
  AND n.selected_tunnel_id <> ''
  AND t.swarm_node_name IS NOT NULL
  AND t.swarm_node_name <> ''
  AND t.target_url IS NOT NULL
  AND t.target_url <> '';

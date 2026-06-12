CREATE TABLE IF NOT EXISTS preferred_endpoint_node_exclusions (
  endpoint_id TEXT NOT NULL REFERENCES preferred_endpoints(id) ON DELETE CASCADE,
  proxy_node_id TEXT NOT NULL REFERENCES proxy_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (endpoint_id, proxy_node_id)
);

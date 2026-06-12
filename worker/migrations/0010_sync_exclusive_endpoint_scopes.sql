INSERT OR IGNORE INTO proxy_node_endpoint_selections (proxy_node_id, endpoint_id, enabled)
SELECT s.proxy_node_id, s.endpoint_id, 1
FROM preferred_endpoint_node_scopes s
JOIN preferred_endpoints e ON e.id = s.endpoint_id
WHERE e.scope = 'node'
  AND e.selection_mode = 'exclusive';

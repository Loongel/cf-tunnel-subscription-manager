PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS proxy_node_tunnel_selections;

ALTER TABLE proxy_nodes DROP COLUMN use_tunnel;
ALTER TABLE proxy_nodes DROP COLUMN selected_tunnel_id;
ALTER TABLE preferred_endpoints DROP COLUMN default_selected;

PRAGMA foreign_keys = ON;

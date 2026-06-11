-- Decouple imported node identity from the human-readable display name.
ALTER TABLE proxy_nodes ADD COLUMN import_key TEXT;
ALTER TABLE proxy_nodes ADD COLUMN import_source_name TEXT;
ALTER TABLE proxy_nodes ADD COLUMN raw_config_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_proxy_nodes_import_key ON proxy_nodes(import_key);
CREATE INDEX IF NOT EXISTS idx_proxy_nodes_import_source ON proxy_nodes(import_source_name);

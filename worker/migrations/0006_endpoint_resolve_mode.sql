ALTER TABLE preferred_endpoints ADD COLUMN resolve_mode TEXT NOT NULL DEFAULT 'none' CHECK (resolve_mode IN ('none', 'ipv4', 'ipv6'));
ALTER TABLE preferred_endpoints ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'additive';

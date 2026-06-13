UPDATE preferred_endpoints
SET port = NULL
WHERE discovery_mode = 'redirect';

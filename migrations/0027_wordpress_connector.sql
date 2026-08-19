PRAGMA foreign_keys = ON;

-- WordPress is a publishing destination. It never becomes the source of truth
-- for asset ownership, licensing, rights, or takedown state.
CREATE TABLE IF NOT EXISTS wordpress_pairing_codes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  site_url TEXT NOT NULL,
  site_name TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wordpress_pairing_codes_active
  ON wordpress_pairing_codes(code_hash, expires_at, used_at);

CREATE TABLE IF NOT EXISTS wordpress_connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  site_url TEXT NOT NULL,
  site_name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  plugin_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wordpress_connections_org
  ON wordpress_connections(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS wordpress_usage_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  licence_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('hosted', 'imported')),
  variant TEXT NOT NULL CHECK (variant IN ('thumb', 'card', 'preview')),
  wordpress_post_id TEXT,
  wordpress_attachment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES wordpress_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (licence_id) REFERENCES licences(id)
);

CREATE INDEX IF NOT EXISTS idx_wordpress_usage_connection
  ON wordpress_usage_events(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wordpress_usage_asset
  ON wordpress_usage_events(asset_id, licence_id, created_at DESC);

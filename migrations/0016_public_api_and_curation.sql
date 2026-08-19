-- Editorial records pre-date organisation scoping.  Make the current demo data
-- explicit and require every new editorial record to remain tenant-bound.
ALTER TABLE showcases ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'org-demo';
ALTER TABLE featured_collections ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'org-demo';
CREATE INDEX IF NOT EXISTS idx_showcases_organization_status ON showcases(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_featured_collections_organization_status ON featured_collections(organization_id, status, created_at DESC);

-- API tokens are stored only as SHA-256 digests. The clear-text token is
-- returned once at creation and is never recoverable from the database.
CREATE TABLE IF NOT EXISTS buyer_api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_buyer_api_keys_active ON buyer_api_keys(token_hash, status);
CREATE INDEX IF NOT EXISTS idx_buyer_api_keys_owner ON buyer_api_keys(organization_id, user_id, created_at DESC);

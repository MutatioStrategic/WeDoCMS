PRAGMA foreign_keys = ON;

-- Tenant-owned Zoho authorization metadata. Refresh tokens are encrypted at
-- rest with the Worker secret ZOHO_TOKEN_ENCRYPTION_KEY; plaintext tokens never
-- enter D1 or an API response.
CREATE TABLE IF NOT EXISTS zoho_connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'zoho' CHECK (provider = 'zoho'),
  account_server TEXT NOT NULL DEFAULT 'https://accounts.zoho.com',
  api_domain TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_validated_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zoho_connections_org_active
  ON zoho_connections(organization_id) WHERE status <> 'revoked';
CREATE INDEX IF NOT EXISTS idx_zoho_connections_org
  ON zoho_connections(organization_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS zoho_oauth_states (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  account_server TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  return_path TEXT NOT NULL DEFAULT '/settings',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zoho_oauth_states_active
  ON zoho_oauth_states(state_hash, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS zoho_contract_metadata (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  module_api_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  validated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES zoho_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zoho_contract_metadata_connection_module
  ON zoho_contract_metadata(connection_id, module_api_name);

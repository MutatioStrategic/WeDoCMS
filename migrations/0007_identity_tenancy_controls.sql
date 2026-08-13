PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN auth_subject TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_subject ON users(auth_subject) WHERE auth_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('buyer', 'contributor', 'editor', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  invited_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('buyer', 'contributor', 'editor', 'admin')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON organization_memberships(organization_id, role, status);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_scan_results (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT,
  upload_id TEXT,
  object_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'blocked', 'error')),
  scanner TEXT NOT NULL,
  checksum TEXT,
  findings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (upload_id) REFERENCES upload_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_media_scan_asset ON media_scan_results(asset_id, created_at DESC);

ALTER TABLE assets ADD COLUMN organization_id TEXT;
ALTER TABLE licences ADD COLUMN organization_id TEXT;
ALTER TABLE takedown_requests ADD COLUMN organization_id TEXT;
ALTER TABLE onboarding_tenders ADD COLUMN organization_id TEXT;
ALTER TABLE seller_contracts ADD COLUMN organization_id TEXT;
ALTER TABLE upload_sessions ADD COLUMN organization_id TEXT;

INSERT OR IGNORE INTO users (id, email, display_name, role) VALUES ('demo-admin', 'admin@veldarchive.local', 'Veld Archive Admin', 'admin');
INSERT OR IGNORE INTO organizations (id, name, slug, created_by) VALUES ('org-demo', 'Veld Archive Demo', 'veld-demo', 'demo-admin');
INSERT OR IGNORE INTO organization_memberships (id, organization_id, user_id, role) VALUES
  ('membership-demo-admin', 'org-demo', 'demo-admin', 'admin'),
  ('membership-demo-contributor', 'org-demo', 'demo-contributor', 'contributor'),
  ('membership-demo-buyer', 'org-demo', 'demo-buyer', 'buyer');

UPDATE assets SET organization_id = 'org-demo' WHERE organization_id IS NULL;
UPDATE licences SET organization_id = 'org-demo' WHERE organization_id IS NULL;
UPDATE takedown_requests SET organization_id = 'org-demo' WHERE organization_id IS NULL;
UPDATE upload_sessions SET organization_id = 'org-demo' WHERE organization_id IS NULL;
UPDATE onboarding_tenders SET organization_id = 'org-demo' WHERE organization_id IS NULL;
UPDATE seller_contracts SET organization_id = 'org-demo' WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_assets_organization_status ON assets(organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_licences_organization_buyer ON licences(organization_id, buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_takedown_organization_requester ON takedown_requests(organization_id, requester_id, created_at DESC);

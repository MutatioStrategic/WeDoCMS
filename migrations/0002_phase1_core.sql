PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN organisation_name TEXT;
ALTER TABLE users ADD COLUMN languages TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN specialties TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK (onboarding_status IN ('not_started', 'in_progress', 'submitted', 'approved', 'rejected'));

CREATE TABLE IF NOT EXISTS organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS organisation_members (
  organisation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'contributor', 'buyer', 'viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organisation_id, user_id),
  FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contributor_profiles (
  user_id TEXT PRIMARY KEY,
  contributor_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (contributor_type IN ('individual', 'agency', 'archive', 'institution')),
  location TEXT,
  equipment TEXT NOT NULL DEFAULT '',
  portfolio_url TEXT,
  payout_provider TEXT,
  payout_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (payout_status IN ('not_started', 'pending', 'verified', 'restricted')),
  terms_accepted_at TEXT,
  identity_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (identity_status IN ('pending', 'submitted', 'verified', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rights_documents (
  id TEXT PRIMARY KEY,
  asset_id TEXT,
  owner_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('model_release', 'property_release', 'permission', 'copyright', 'identity', 'terms')),
  object_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS asset_reviews (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'needs_changes', 'withdrawn')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, version_number),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS search_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'keyword',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_owner_status ON assets(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_asset ON asset_reviews(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rights_asset ON rights_documents(asset_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);

INSERT OR IGNORE INTO contributor_profiles (user_id, contributor_type, location, identity_status)
VALUES ('demo-contributor', 'agency', 'Cape Town, Western Cape', 'verified');

INSERT OR IGNORE INTO users (id, email, display_name, role, onboarding_status)
VALUES ('demo-admin', 'editor@stockvel.local', 'Stockvel Editorial Desk', 'admin', 'approved');

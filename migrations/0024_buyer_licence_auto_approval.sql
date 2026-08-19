PRAGMA foreign_keys = ON;

ALTER TABLE licences ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (approval_status IN ('pending', 'auto_approved'));
ALTER TABLE licences ADD COLUMN approval_method TEXT
  CHECK (approval_method IS NULL OR approval_method IN ('buyer_auto_approval'));
ALTER TABLE licences ADD COLUMN approved_at TEXT;
ALTER TABLE licences ADD COLUMN approved_by TEXT;
ALTER TABLE licences ADD COLUMN auto_approval_preference_id TEXT;

CREATE TABLE IF NOT EXISTS buyer_licence_approval_preferences (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  terms_version TEXT NOT NULL,
  signed_at TEXT,
  signed_by TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, buyer_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (buyer_id) REFERENCES users(id),
  FOREIGN KEY (signed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_licence_auto_approval_lookup
  ON buyer_licence_approval_preferences (organization_id, buyer_id, enabled);

CREATE INDEX IF NOT EXISTS idx_licences_approval_status
  ON licences (organization_id, buyer_id, approval_status, created_at DESC);

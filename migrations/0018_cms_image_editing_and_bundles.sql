PRAGMA foreign_keys = ON;

-- An edit is a recipe and an optional rendered preview. The source asset and
-- its original R2 object are never mutated.
CREATE TABLE IF NOT EXISTS asset_edit_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  recipe_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, version_number),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_asset_edit_versions_asset
  ON asset_edit_versions(organization_id, asset_id, version_number DESC);

CREATE TABLE IF NOT EXISTS asset_derivative_exports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  edit_version_id TEXT NOT NULL,
  campaign_id TEXT,
  licence_id TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('original', 'edited', 'social_square', 'portrait', 'landscape', 'story_9_16', 'reel_cover', 'linkedin', 'web_hero', 'email_header')),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'revoked')),
  rights_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (source_asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (edit_version_id) REFERENCES asset_edit_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
  FOREIGN KEY (licence_id) REFERENCES licences(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_asset_derivative_exports_asset
  ON asset_derivative_exports(organization_id, asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_derivative_exports_campaign
  ON asset_derivative_exports(campaign_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_bundles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  bundle_type TEXT NOT NULL CHECK (bundle_type IN ('social_media', 'website', 'paid_ads', 'print_handoff', 'full_archive')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'expired', 'revoked', 'failed')),
  object_key TEXT,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  approval_note TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  approved_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS campaign_bundle_items (
  bundle_id TEXT NOT NULL,
  derivative_id TEXT,
  asset_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('derivative', 'original', 'thumbnail', 'licence_certificate', 'attribution', 'brief', 'metadata', 'audit_manifest')),
  archive_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bundle_id, archive_path),
  FOREIGN KEY (bundle_id) REFERENCES campaign_bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (derivative_id) REFERENCES asset_derivative_exports(id) ON DELETE SET NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_campaign_bundles_campaign
  ON campaign_bundles(organization_id, campaign_id, created_at DESC);
PRAGMA foreign_keys = ON;

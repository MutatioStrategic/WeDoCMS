PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_lightboxes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, owner_id, name),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_lightbox_assets (
  lightbox_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lightbox_id, asset_id),
  FOREIGN KEY (lightbox_id) REFERENCES user_lightboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_lightboxes_owner ON user_lightboxes(organization_id, owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_lightbox_assets_asset ON user_lightbox_assets(asset_id, added_at DESC);

PRAGMA foreign_keys = ON;

-- Marketplace delivery metadata. Originals remain private; preview_key is the only
-- object eligible for anonymous delivery.
ALTER TABLE assets ADD COLUMN media_content_type TEXT;
ALTER TABLE assets ADD COLUMN media_width INTEGER;
ALTER TABLE assets ADD COLUMN media_height INTEGER;
ALTER TABLE assets ADD COLUMN media_duration_seconds INTEGER;
ALTER TABLE assets ADD COLUMN media_orientation TEXT CHECK (media_orientation IN ('landscape', 'portrait', 'square'));
ALTER TABLE assets ADD COLUMN media_has_people INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN media_usage_type TEXT NOT NULL DEFAULT 'commercial' CHECK (media_usage_type IN ('commercial', 'editorial'));
ALTER TABLE assets ADD COLUMN media_ai_generated INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_assets_discovery ON assets(organization_id, status, kind, media_orientation, media_usage_type, created_at DESC);

CREATE TABLE IF NOT EXISTS licence_downloads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  licence_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'original' CHECK (variant IN ('original', 'preview')),
  object_key TEXT NOT NULL,
  content_type TEXT,
  bytes_served INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_licence_downloads_buyer ON licence_downloads(organization_id, buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_licence_downloads_licence ON licence_downloads(licence_id, created_at DESC);

ALTER TABLE user_lightboxes ADD COLUMN share_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_lightboxes_share_token ON user_lightboxes(share_token_hash) WHERE share_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_lightbox_members (
  lightbox_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lightbox_id, user_id),
  FOREIGN KEY (lightbox_id) REFERENCES user_lightboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_lightbox_members_user ON user_lightbox_members(user_id, created_at DESC);

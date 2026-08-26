-- Introductory free photo downloads are a one-time allowance per registered buyer.
-- The seller controls which published image listings can participate.
PRAGMA foreign_keys = ON;

ALTER TABLE assets ADD COLUMN free_download_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (free_download_enabled IN (0, 1));

-- Demo environment: make two published photos useful for exercising signup,
-- allowance exhaustion, and the subscription upsell locally.
UPDATE assets SET free_download_enabled = 1
WHERE kind = 'image' AND status = 'published'
  AND id IN ('asset-table-mountain', 'asset-braai-cape-flats', 'asset-demo-table-mountain', 'asset-demo-garden-route');

CREATE INDEX IF NOT EXISTS idx_assets_free_download
  ON assets(status, kind, free_download_enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS buyer_free_downloads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, buyer_id, asset_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_buyer_free_downloads_buyer
  ON buyer_free_downloads(organization_id, buyer_id, created_at DESC);

PRAGMA foreign_keys = ON;

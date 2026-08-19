-- Seller performance joins are deliberately derived from the canonical event
-- tables. These indexes keep the board cheap without introducing a second,
-- eventually-consistent seller ledger.
CREATE INDEX IF NOT EXISTS idx_media_download_events_owner_asset
  ON media_download_events (organization_id, asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_asset_views_date
  ON analytics_daily (asset_id, metric_type, metric_date DESC);

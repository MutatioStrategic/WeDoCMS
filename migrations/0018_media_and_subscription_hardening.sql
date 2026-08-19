-- Idempotency and content identity for direct-to-R2 uploads.
ALTER TABLE upload_sessions ADD COLUMN idempotency_key TEXT;
ALTER TABLE upload_sessions ADD COLUMN content_sha256 TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_sessions_idempotency
  ON upload_sessions (organization_id, owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Responsive image variants and video poster frames. preview_key remains the
-- canonical 1800px public preview for backwards compatibility.
ALTER TABLE assets ADD COLUMN preview_640_key TEXT;
ALTER TABLE assets ADD COLUMN preview_1200_key TEXT;
ALTER TABLE assets ADD COLUMN video_poster_key TEXT;

-- Subscription payment state and provider references.
ALTER TABLE photographer_subscriptions ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photographer_subscriptions ADD COLUMN currency TEXT NOT NULL DEFAULT 'ZAR';
ALTER TABLE photographer_subscriptions ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE photographer_subscriptions ADD COLUMN payment_provider TEXT;
ALTER TABLE photographer_subscriptions ADD COLUMN payment_reference TEXT;

ALTER TABLE payment_webhook_events ADD COLUMN subscription_id TEXT;
ALTER TABLE payment_webhook_events ADD COLUMN product_type TEXT NOT NULL DEFAULT 'licence';
CREATE INDEX IF NOT EXISTS idx_payment_events_subscription ON payment_webhook_events (subscription_id, provider_event_id);

-- Minimal audit trail for original downloads. No URLs or source bytes are stored.
CREATE TABLE IF NOT EXISTS media_download_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entitlement_type TEXT NOT NULL CHECK (entitlement_type IN ('licence', 'subscription', 'owner', 'staff')),
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_media_download_events_asset ON media_download_events (organization_id, asset_id, created_at DESC);

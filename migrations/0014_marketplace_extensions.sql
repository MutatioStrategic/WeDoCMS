PRAGMA foreign_keys = ON;

-- Saved searches power buyer "new match" alerts (notification + best-effort email).
CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'all' CHECK (kind IN ('all', 'image', 'video')),
  location TEXT,
  location_type TEXT,
  category TEXT,
  notify_on_new INTEGER NOT NULL DEFAULT 1,
  last_notified_at TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_searches_notify ON saved_searches(notify_on_new);

-- Buyer lightboxes are personal shortlists, distinct from editorial featured_collections.
CREATE TABLE IF NOT EXISTS buyer_lightboxes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_buyer_lightboxes_user ON buyer_lightboxes(organization_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS buyer_lightbox_assets (
  lightbox_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lightbox_id, asset_id),
  FOREIGN KEY (lightbox_id) REFERENCES buyer_lightboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- Outbound webhook subscriptions for the public buyer/integration API.
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  target_url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_org ON webhook_subscriptions(organization_id, status);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  response_status INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT,
  FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription ON webhook_deliveries(subscription_id, created_at DESC);

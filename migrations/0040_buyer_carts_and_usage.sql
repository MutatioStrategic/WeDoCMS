CREATE TABLE IF NOT EXISTS shopping_carts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_out', 'abandoned', 'expired')),
  total_credits INTEGER NOT NULL DEFAULT 0 CHECK (total_credits >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  checked_out_at TEXT,
  payment_reference TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shopping_carts_buyer
  ON shopping_carts (organization_id, buyer_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_shopping_carts_expiry
  ON shopping_carts (expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS buyer_usage_reports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  report_period_start TEXT NOT NULL,
  report_period_end TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_licences INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  assets_licensed_json TEXT NOT NULL DEFAULT '[]',
  download_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (organization_id, buyer_id, report_period_start, report_period_end)
);
CREATE INDEX IF NOT EXISTS idx_buyer_usage_reports_period
  ON buyer_usage_reports (organization_id, buyer_id, report_period_start DESC);

CREATE TABLE IF NOT EXISTS asset_usage_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  licence_id TEXT,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('view', 'download', 'share', 'publish')),
  context_url TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_asset_usage_logs_buyer
  ON asset_usage_logs (organization_id, user_id, action_type, created_at DESC);

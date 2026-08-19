PRAGMA foreign_keys = ON;

-- Saved searches are explicit buyer preferences. They are tenant scoped and are
-- never inferred from anonymous search traffic.
CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  media_kind TEXT NOT NULL DEFAULT 'all' CHECK (media_kind IN ('all', 'image', 'video')),
  alert_frequency TEXT NOT NULL DEFAULT 'none' CHECK (alert_frequency IN ('none', 'daily', 'weekly')),
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_alert_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, owner_id, name),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_owner
  ON saved_searches(organization_id, owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_searches_alerts
  ON saved_searches(alert_frequency, next_alert_at)
  WHERE alert_frequency <> 'none';

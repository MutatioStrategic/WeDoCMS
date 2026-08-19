PRAGMA foreign_keys = ON;

-- 0014_marketplace_extensions.sql owns the saved_searches table. Keep this
-- migration additive: the two branches previously attempted incompatible
-- definitions (owner_id/name versus user_id/label), which made a clean local
-- migration fail when SQLite reached this file.
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_updated
  ON saved_searches(organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_searches_alerts
  ON saved_searches(notify_on_new, last_notified_at);

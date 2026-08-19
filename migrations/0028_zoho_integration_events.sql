PRAGMA foreign_keys = ON;

-- Provider references and redacted metadata only. OAuth secrets never belong in D1.
CREATE TABLE IF NOT EXISTS zoho_integration_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  app TEXT NOT NULL CHECK (app IN ('social', 'crm', 'desk', 'campaigns', 'analytics')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  provider_reference TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zoho_events_entity
  ON zoho_integration_events(organization_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zoho_events_app
  ON zoho_integration_events(organization_id, app, status, created_at DESC);

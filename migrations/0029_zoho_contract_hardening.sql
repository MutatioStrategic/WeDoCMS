PRAGMA foreign_keys = ON;

-- A stable payload key makes retries safe while still allowing a new CMS
-- payload version to create a new handoff. Failed attempts are upserted into
-- the same row when the provider is retried.
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoho_event_idempotency
  ON zoho_integration_events(organization_id, app, action, entity_type, entity_id, idempotency_key);

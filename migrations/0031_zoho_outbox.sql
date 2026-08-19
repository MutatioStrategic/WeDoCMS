PRAGMA foreign_keys = ON;

-- Durable boundary for every Zoho write. The idempotency key is unique within
-- the database so retries cannot create a second logical delivery.
CREATE TABLE IF NOT EXISTS zoho_outbox_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  app TEXT NOT NULL CHECK (app IN ('social', 'crm', 'desk', 'campaigns', 'analytics')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  contract_version TEXT NOT NULL DEFAULT '1.0',
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'unknown')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  provider_reference TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zoho_outbox_due
  ON zoho_outbox_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_zoho_outbox_org
  ON zoho_outbox_jobs(organization_id, created_at DESC);

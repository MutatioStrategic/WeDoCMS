PRAGMA foreign_keys = ON;

ALTER TABLE licences ADD COLUMN payment_provider TEXT;
ALTER TABLE licences ADD COLUMN payment_reference TEXT;
ALTER TABLE licences ADD COLUMN paid_at TEXT;
ALTER TABLE licences ADD COLUMN refunded_at TEXT;

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  licence_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  failure_reason TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE (provider, provider_event_id),
  FOREIGN KEY (licence_id) REFERENCES licences(id)
);

CREATE TABLE IF NOT EXISTS payment_reconciliation_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  started_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  discrepancy_count INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (started_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rights_case_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (case_id) REFERENCES takedown_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ops_actions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_status ON payment_webhook_events(status, received_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_licence ON payment_webhook_events(licence_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_rights_case_events_case ON rights_case_events(case_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ops_actions_org ON ops_actions(organization_id, created_at DESC);

PRAGMA foreign_keys = OFF;

-- Tenant ownership is deliberately nullable for historical rows that cannot be
-- proved to belong to an organisation. Application reads fail closed for those
-- rows; the backfill below fills every row that can be tied to membership or a
-- known tenant-owned resource.
ALTER TABLE audit_log_events ADD COLUMN organization_id TEXT;
ALTER TABLE audit_exports ADD COLUMN organization_id TEXT;
ALTER TABLE audit_exports ADD COLUMN created_by TEXT;
ALTER TABLE contributor_verification_cases ADD COLUMN organization_id TEXT;

UPDATE audit_log_events
SET organization_id = COALESCE(
  (SELECT om.organization_id FROM organization_memberships om WHERE om.user_id = audit_log_events.actor_id AND om.status = 'active' ORDER BY om.created_at LIMIT 1),
  (SELECT a.organization_id FROM assets a WHERE audit_log_events.resource_type = 'asset' AND a.id = audit_log_events.resource_id),
  (SELECT l.organization_id FROM licences l WHERE audit_log_events.resource_type = 'licence' AND l.id = audit_log_events.resource_id),
  (SELECT c.organization_id FROM campaigns c WHERE audit_log_events.resource_type = 'campaign' AND c.id = audit_log_events.resource_id),
  (SELECT t.organization_id FROM takedown_requests t WHERE audit_log_events.resource_type = 'takedown_request' AND t.id = audit_log_events.resource_id),
  (SELECT vc.organization_id FROM contributor_verification_cases vc WHERE audit_log_events.resource_type = 'verification_case' AND vc.id = audit_log_events.resource_id)
)
WHERE organization_id IS NULL;

UPDATE contributor_verification_cases
SET organization_id = (
  SELECT om.organization_id FROM organization_memberships om
  WHERE om.user_id = contributor_verification_cases.contributor_id
    AND om.status = 'active'
  ORDER BY om.created_at LIMIT 1
)
WHERE organization_id IS NULL;

UPDATE audit_exports
SET organization_id = (
  SELECT e.organization_id FROM audit_log_events e
  WHERE e.stream_id = audit_exports.stream_id
    AND e.residency_region = audit_exports.residency_region
    AND e.organization_id IS NOT NULL
  ORDER BY e.sequence LIMIT 1
)
WHERE organization_id IS NULL;

ALTER TABLE assets ADD COLUMN stream_status TEXT NOT NULL DEFAULT 'not_configured'
  CHECK (stream_status IN ('not_configured', 'uploading', 'processing', 'ready', 'error'));
ALTER TABLE assets ADD COLUMN stream_progress INTEGER NOT NULL DEFAULT 0
  CHECK (stream_progress BETWEEN 0 AND 100);
ALTER TABLE assets ADD COLUMN stream_error_code TEXT;
ALTER TABLE assets ADD COLUMN stream_error_text TEXT;
ALTER TABLE assets ADD COLUMN stream_updated_at TEXT;
ALTER TABLE assets ADD COLUMN stream_ready_at TEXT;

CREATE TABLE IF NOT EXISTS stream_uploads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  upload_url TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'uploading', 'processing', 'ready', 'error', 'expired')),
  expires_at TEXT NOT NULL,
  error_code TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_uploads_idempotency
  ON stream_uploads(organization_id, asset_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_stream_uploads_provider_uid
  ON stream_uploads(provider_uid, organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_bundle_builds (
  bundle_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'completed', 'failed')),
  error_text TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bundle_id) REFERENCES campaign_bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_events_organization
  ON audit_log_events(organization_id, residency_region, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_exports_organization
  ON audit_exports(organization_id, residency_region, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_cases_organization
  ON contributor_verification_cases(organization_id, residency_region, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_stream_status
  ON assets(organization_id, stream_status, stream_updated_at DESC);

PRAGMA foreign_keys = ON;

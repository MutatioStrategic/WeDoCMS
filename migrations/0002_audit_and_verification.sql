PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN residency_region TEXT NOT NULL DEFAULT 'za';

CREATE TABLE IF NOT EXISTS audit_chain_heads (
  stream_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL DEFAULT 0,
  head_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log_events (
  event_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'contributor', 'service', 'admin')),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  residency_region TEXT NOT NULL CHECK (residency_region IN ('za', 'eu')),
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  signature TEXT NOT NULL,
  key_id TEXT NOT NULL,
  public_key_jwk TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (stream_id, sequence)
);

CREATE TABLE IF NOT EXISTS audit_exports (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  residency_region TEXT NOT NULL CHECK (residency_region IN ('za', 'eu')),
  from_occurred_at TEXT,
  to_occurred_at TEXT,
  event_count INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contributor_verification_cases (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL,
  residency_region TEXT NOT NULL CHECK (residency_region IN ('za', 'eu')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('individual', 'business')),
  provider TEXT NOT NULL,
  provider_case_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'verified', 'rejected', 'expired')),
  risk_level TEXT NOT NULL DEFAULT 'unknown' CHECK (risk_level IN ('unknown', 'low', 'medium', 'high')),
  sanctions_status TEXT NOT NULL DEFAULT 'not_checked' CHECK (sanctions_status IN ('not_checked', 'clear', 'potential_match', 'blocked')),
  pep_status TEXT NOT NULL DEFAULT 'not_checked' CHECK (pep_status IN ('not_checked', 'clear', 'potential_match')),
  adverse_media_status TEXT NOT NULL DEFAULT 'not_checked' CHECK (adverse_media_status IN ('not_checked', 'clear', 'potential_match')),
  retention_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contributor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS verification_documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('government_id', 'proof_of_address', 'business_registration', 'beneficial_owner_register', 'bank_account_proof')),
  object_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  issued_country TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES contributor_verification_cases(id)
);

CREATE TABLE IF NOT EXISTS verification_checks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  check_type TEXT NOT NULL CHECK (check_type IN ('identity', 'liveness', 'sanctions', 'pep', 'adverse_media', 'beneficial_ownership')),
  result TEXT NOT NULL CHECK (result IN ('pending', 'clear', 'potential_match', 'failed', 'not_applicable')),
  provider_reference TEXT,
  checked_at TEXT,
  FOREIGN KEY (case_id) REFERENCES contributor_verification_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_events_stream_sequence ON audit_log_events(stream_id, sequence);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON audit_log_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_residency ON audit_log_events(residency_region);
CREATE INDEX IF NOT EXISTS idx_verification_cases_contributor ON contributor_verification_cases(contributor_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_documents_case ON verification_documents(case_id);

CREATE TRIGGER IF NOT EXISTS audit_log_events_advance_head
AFTER INSERT ON audit_log_events
BEGIN
  UPDATE audit_chain_heads
  SET sequence = NEW.sequence, head_hash = NEW.event_hash, updated_at = CURRENT_TIMESTAMP
  WHERE stream_id = NEW.stream_id
    AND sequence = NEW.sequence - 1
    AND head_hash = NEW.previous_hash;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'audit chain head mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS audit_log_events_no_update
BEFORE UPDATE ON audit_log_events
BEGIN
  SELECT RAISE(ABORT, 'audit log events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_events_no_delete
BEFORE DELETE ON audit_log_events
BEGIN
  SELECT RAISE(ABORT, 'audit log events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_exports_no_update
BEFORE UPDATE ON audit_exports
BEGIN
  SELECT RAISE(ABORT, 'audit exports are immutable');
END;

CREATE TRIGGER IF NOT EXISTS audit_exports_no_delete
BEFORE DELETE ON audit_exports
BEGIN
  SELECT RAISE(ABORT, 'audit exports are append-only');
END;

UPDATE users SET residency_region = 'za' WHERE residency_region IS NULL OR residency_region = '';

PRAGMA foreign_keys = ON;

-- Provider-neutral identity events. Tokens, passwords, and raw IP addresses
-- are deliberately excluded; the Worker stores only a one-way IP hash and
-- bounded request metadata for incident response.
CREATE TABLE IF NOT EXISTS auth_security_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('auth0', 'supabase', 'unknown')),
  event_type TEXT NOT NULL,
  subject TEXT,
  organization_id TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_type_time
  ON auth_security_events(provider, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_subject_time
  ON auth_security_events(subject, created_at DESC);

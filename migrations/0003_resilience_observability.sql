PRAGMA foreign_keys = ON;

ALTER TABLE upload_sessions ADD COLUMN completed_at TEXT;
ALTER TABLE upload_sessions ADD COLUMN failure_reason TEXT;
ALTER TABLE upload_sessions ADD COLUMN uploaded_etag TEXT;

CREATE TABLE IF NOT EXISTS stream_events (
  id TEXT PRIMARY KEY,
  provider_event_id TEXT NOT NULL UNIQUE,
  stream_uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stream_events_uid ON stream_events(stream_uid, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status, created_at DESC);

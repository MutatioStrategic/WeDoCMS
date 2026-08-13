PRAGMA foreign_keys = ON;

-- Expensive image understanding runs once after upload; buyer search uses the stored vector.
ALTER TABLE assets ADD COLUMN ocr_text TEXT NOT NULL DEFAULT '';
ALTER TABLE assets ADD COLUMN vector_index_status TEXT NOT NULL DEFAULT 'not_indexed'
  CHECK (vector_index_status IN ('not_indexed', 'pending', 'indexed', 'error'));
ALTER TABLE assets ADD COLUMN vector_indexed_at TEXT;
ALTER TABLE assets ADD COLUMN vector_index_version TEXT;

CREATE TABLE IF NOT EXISTS photo_ai_jobs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('enrich', 'sync_index')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, operation),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_ai_jobs_queue ON photo_ai_jobs(status, updated_at, requested_at);
CREATE INDEX IF NOT EXISTS idx_assets_vector_status ON assets(vector_index_status, status);

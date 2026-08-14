-- Keep upload-time semantic vectors available for internal review and batch
-- validation without exposing unapproved media through the public index.
ALTER TABLE assets ADD COLUMN candidate_vector_status TEXT NOT NULL DEFAULT 'not_indexed'
  CHECK (candidate_vector_status IN ('not_indexed', 'pending', 'indexed', 'error'));
ALTER TABLE assets ADD COLUMN candidate_vector_indexed_at TEXT;
ALTER TABLE assets ADD COLUMN candidate_vector_version TEXT;
ALTER TABLE assets ADD COLUMN candidate_vector_id TEXT;

CREATE INDEX IF NOT EXISTS idx_assets_candidate_vector_status
  ON assets(candidate_vector_status, status);

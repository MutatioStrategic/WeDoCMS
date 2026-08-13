PRAGMA foreign_keys = OFF;

-- A revision is advanced whenever source media or reviewable metadata changes.
-- Queue messages carry both this revision and the source ETag, so stale model
-- completions cannot overwrite a newer seller/editor decision.
ALTER TABLE assets ADD COLUMN asset_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assets ADD COLUMN source_etag TEXT;
ALTER TABLE assets ADD COLUMN enriched_revision INTEGER;
ALTER TABLE assets ADD COLUMN reviewed_revision INTEGER;
ALTER TABLE assets ADD COLUMN approved_revision INTEGER;
ALTER TABLE assets ADD COLUMN indexed_revision INTEGER;
ALTER TABLE assets ADD COLUMN vector_index_id TEXT;
ALTER TABLE assets ADD COLUMN index_terminal_reason TEXT;

-- Pixel-derived place classification is deliberately separate from geographic
-- evidence supplied by a seller, EXIF extraction, or an editor.
ALTER TABLE assets ADD COLUMN visual_location_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK (visual_location_type IN ('urban_street', 'coastal_landscape', 'market_scene', 'indoor', 'residential', 'rural_landscape', 'industrial', 'event', 'transport', 'nature', 'sports', 'food', 'other', 'unknown'));
ALTER TABLE assets ADD COLUMN primary_category TEXT NOT NULL DEFAULT 'other'
  CHECK (primary_category IN ('people', 'lifestyle', 'travel', 'nature', 'architecture', 'food', 'business', 'transport', 'arts_culture', 'sport', 'news_editorial', 'objects', 'other'));
ALTER TABLE assets ADD COLUMN scene_attributes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE assets ADD COLUMN detected_language TEXT NOT NULL DEFAULT 'none';
ALTER TABLE assets ADD COLUMN text_readability TEXT NOT NULL DEFAULT 'no_text'
  CHECK (text_readability IN ('clear', 'partial', 'unreadable', 'no_text'));
ALTER TABLE assets ADD COLUMN ocr_confidence REAL;
ALTER TABLE assets ADD COLUMN ai_field_confidences TEXT NOT NULL DEFAULT '{}';
ALTER TABLE assets ADD COLUMN enrichment_validation_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE assets ADD COLUMN geographic_location_source TEXT NOT NULL DEFAULT 'none'
  CHECK (geographic_location_source IN ('none', 'seller', 'exif', 'evidence', 'editor'));

UPDATE assets
SET geographic_location_source = CASE
      WHEN province IS NOT NULL OR city IS NOT NULL OR locality IS NOT NULL OR landmark IS NOT NULL THEN 'seller'
      ELSE 'none'
    END,
    reviewed_revision = CASE WHEN human_verified = 1 THEN asset_revision ELSE NULL END,
    approved_revision = CASE WHEN status = 'published' THEN asset_revision ELSE NULL END,
    indexed_revision = CASE WHEN vector_index_status = 'indexed' THEN asset_revision ELSE NULL END;

DROP INDEX IF EXISTS idx_photo_ai_jobs_queue;
ALTER TABLE photo_ai_jobs RENAME TO photo_ai_jobs_legacy;

CREATE TABLE photo_ai_jobs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('enrich', 'sync_index')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'needs_review', 'failed', 'dead_lettered', 'skipped')),
  asset_revision INTEGER NOT NULL,
  source_etag TEXT,
  prompt_version TEXT NOT NULL DEFAULT 'photo-enrichment-v2',
  schema_version TEXT NOT NULL DEFAULT 'photo-metadata-v2',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_class TEXT CHECK (error_class IN ('retryable', 'permanent', 'validation', 'stale')),
  last_error TEXT,
  vector_id TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  next_attempt_at TEXT,
  dead_lettered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, operation, asset_revision),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

INSERT INTO photo_ai_jobs (
  id, asset_id, operation, status, asset_revision, source_etag, attempts,
  last_error, requested_at, started_at, completed_at, updated_at, created_at
)
SELECT j.id, j.asset_id, j.operation,
  CASE WHEN j.status IN ('queued', 'running', 'completed', 'failed', 'skipped') THEN j.status ELSE 'failed' END,
  COALESCE(a.asset_revision, 1), a.source_etag, j.attempts, j.last_error,
  j.requested_at, j.started_at, j.completed_at, j.updated_at, j.created_at
FROM photo_ai_jobs_legacy j
JOIN assets a ON a.id = j.asset_id;

DROP TABLE photo_ai_jobs_legacy;

CREATE INDEX idx_photo_ai_jobs_queue
  ON photo_ai_jobs(status, error_class, next_attempt_at, requested_at);
CREATE INDEX idx_photo_ai_jobs_asset_revision
  ON photo_ai_jobs(asset_id, asset_revision, operation);

CREATE TABLE photo_ai_provenance (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('enrich', 'sync_index')),
  asset_revision INTEGER NOT NULL,
  source_etag TEXT,
  model TEXT,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'needs_review', 'stale', 'failed', 'dead_lettered', 'indexed', 'deleted', 'reviewed', 'approved', 'rejected', 'withdrawn')),
  error_class TEXT CHECK (error_class IN ('retryable', 'permanent', 'validation', 'stale')),
  result_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  reviewed_by TEXT,
  review_outcome TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES photo_ai_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX idx_photo_ai_provenance_asset_created
  ON photo_ai_provenance(asset_id, created_at DESC);
CREATE INDEX idx_photo_ai_provenance_job_attempt
  ON photo_ai_provenance(job_id, attempt);

-- D1 supports FTS5. Each document ID contains the approved asset revision;
-- searches join only the current approved revision, making old documents inert.
CREATE VIRTUAL TABLE asset_search_fts USING fts5(
  document_id UNINDEXED,
  asset_id UNINDEXED,
  revision UNINDEXED,
  title,
  description,
  caption,
  subject_tags,
  context_tags,
  visible_text,
  location_type,
  category,
  scene_attributes,
  geographic_context,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO asset_search_fts (
  document_id, asset_id, revision, title, description, caption, subject_tags,
  context_tags, visible_text, location_type, category, scene_attributes,
  geographic_context
)
SELECT
  id || '::r' || asset_revision,
  id,
  asset_revision,
  title,
  description,
  caption,
  replace(replace(subject_tags, '[', ' '), ']', ' '),
  replace(replace(cultural_tags, '[', ' '), ']', ' '),
  ocr_text,
  replace(visual_location_type, '_', ' '),
  replace(primary_category, '_', ' '),
  replace(replace(scene_attributes, '[', ' '), ']', ' '),
  trim(COALESCE(country, '') || ' ' || COALESCE(province, '') || ' ' || COALESCE(city, '') || ' ' || COALESCE(locality, '') || ' ' || COALESCE(landmark, ''))
FROM assets
WHERE status = 'published';

PRAGMA foreign_keys = ON;

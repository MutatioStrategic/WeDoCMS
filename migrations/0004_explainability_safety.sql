PRAGMA foreign_keys = ON;

-- Explainability is persisted separately from the model's raw confidence so clients
-- can distinguish relevance, provenance, and human verification.
ALTER TABLE assets ADD COLUMN ai_confidence REAL;
ALTER TABLE assets ADD COLUMN metadata_review_status TEXT NOT NULL DEFAULT 'needs_context'
  CHECK (metadata_review_status IN ('reviewed', 'needs_context', 'blocked'));
ALTER TABLE assets ADD COLUMN metadata_review_note TEXT NOT NULL DEFAULT 'Confirm place and cultural context with the contributor before publishing.';
ALTER TABLE assets ADD COLUMN metadata_provenance TEXT NOT NULL DEFAULT 'contributor'
  CHECK (metadata_provenance IN ('contributor', 'editor', 'ai_suggested'));

UPDATE assets
SET ai_confidence = authenticity_confidence,
    metadata_review_status = CASE WHEN human_verified = 1 THEN 'reviewed' ELSE 'needs_context' END,
    metadata_provenance = CASE WHEN human_verified = 1 THEN 'editor' ELSE 'ai_suggested' END
WHERE ai_confidence IS NULL;

CREATE INDEX IF NOT EXISTS idx_assets_moderation_priority
  ON assets(status, ai_confidence DESC, created_at ASC);

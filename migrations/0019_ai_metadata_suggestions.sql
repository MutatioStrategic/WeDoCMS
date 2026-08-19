-- Preserve the complete model suggestion separately from editor-approved metadata.
-- A review-required result remains available for later human acceptance or correction.
ALTER TABLE assets ADD COLUMN ai_metadata_suggestion_json TEXT NOT NULL DEFAULT '{}';

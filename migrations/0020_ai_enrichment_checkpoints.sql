-- Persist the normalized vision result before any downstream indexing or
-- observability work. A retry can reuse this checkpoint without calling AI.
ALTER TABLE assets ADD COLUMN ai_metadata_suggestion_revision INTEGER;
ALTER TABLE assets ADD COLUMN ai_metadata_suggestion_etag TEXT;

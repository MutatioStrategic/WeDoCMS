PRAGMA foreign_keys = ON;

ALTER TABLE assets ADD COLUMN workflow_stage TEXT NOT NULL DEFAULT 'ingestion'
  CHECK (workflow_stage IN ('ingestion', 'ai_tagging', 'curator_correction', 'approval'));
ALTER TABLE assets ADD COLUMN ai_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE assets ADD COLUMN curator_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE assets ADD COLUMN source_file_name TEXT;
ALTER TABLE assets ADD COLUMN last_reviewed_at TEXT;

CREATE TABLE IF NOT EXISTS contributor_releases (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  release_type TEXT NOT NULL CHECK (release_type IN ('model', 'property')),
  status TEXT NOT NULL CHECK (status IN ('unknown', 'not_required', 'pending', 'verified')),
  document_name TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE TABLE IF NOT EXISTS metadata_events (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('ingested', 'ai_tagged', 'curator_corrected', 'approved', 'rejected')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_workflow_stage ON assets(workflow_stage);
CREATE INDEX IF NOT EXISTS idx_releases_asset ON contributor_releases(asset_id);

UPDATE assets SET workflow_stage = CASE
  WHEN status = 'published' THEN 'approval'
  WHEN status = 'needs_review' THEN 'curator_correction'
  WHEN status = 'processing' THEN 'ai_tagging'
  ELSE 'ingestion'
END
WHERE workflow_stage = 'ingestion';

INSERT OR IGNORE INTO contributor_releases (id, asset_id, release_type, status, document_name, verified_at)
VALUES
  ('release-braai-model', 'asset-braai-cape-flats', 'model', 'verified', 'braai-participant-release.pdf', CURRENT_TIMESTAMP),
  ('release-braai-property', 'asset-braai-cape-flats', 'property', 'not_required', NULL, NULL),
  ('release-garden-property', 'asset-garden-route-drive', 'property', 'pending', 'garden-route-location-release.pdf', NULL);


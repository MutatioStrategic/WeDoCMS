PRAGMA foreign_keys = ON;

ALTER TABLE assets ADD COLUMN artist_license_key TEXT NOT NULL DEFAULT 'custom'
  CHECK (artist_license_key IN ('custom', 'cc_by_4_0', 'cc_by_sa_4_0', 'mit', 'other'));
ALTER TABLE assets ADD COLUMN artist_license_version TEXT;
ALTER TABLE assets ADD COLUMN artist_license_url TEXT;
ALTER TABLE assets ADD COLUMN artist_license_terms TEXT;
ALTER TABLE assets ADD COLUMN artist_license_sha256 TEXT;
ALTER TABLE assets ADD COLUMN artist_license_accepted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_assets_artist_license ON assets(artist_license_key, artist_license_version);

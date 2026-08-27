PRAGMA foreign_keys = ON;

-- Public marketplace identity is intentionally separate from the private contributor
-- onboarding profile. A contributor has to opt in before any profile is discoverable.
CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  specialties_json TEXT NOT NULL DEFAULT '[]',
  website_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  featured_asset_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (featured_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_creator_profiles_public_discovery
  ON creator_profiles(visibility, slug, updated_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_collections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_asset_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, slug),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS portfolio_collection_assets (
  collection_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collection_id, asset_id),
  FOREIGN KEY (collection_id) REFERENCES portfolio_collections(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolio_collections_public
  ON portfolio_collections(owner_id, visibility, updated_at DESC);

-- Event rows are retained only for commercial/account history. Aggregate counters
-- continue to be used for anonymous discovery analytics and never contain IP or UA.
CREATE TABLE IF NOT EXISTS asset_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'save', 'download', 'licence', 'conversion')),
  collection_id TEXT,
  licence_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (collection_id) REFERENCES portfolio_collections(id) ON DELETE SET NULL,
  FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_events_asset_type_date
  ON asset_events(asset_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_events_actor_date
  ON asset_events(actor_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS media_processing_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('image_variants', 'video_transcode', 'metadata_probe')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  provider_job_id TEXT,
  error_code TEXT,
  error_detail TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(asset_id, job_type),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_derivatives (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('thumb', 'card', 'preview', 'download', 'stream_hls', 'stream_dash')),
  object_key TEXT,
  provider_uid TEXT,
  width INTEGER,
  height INTEGER,
  fps REAL,
  duration_seconds REAL,
  content_type TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, variant),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS licence_products (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  restrictions_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE licences ADD COLUMN product_code TEXT;

CREATE TABLE IF NOT EXISTS licence_evidence (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('issued', 'receipt', 'download', 'usage_attested', 'refunded', 'expired')),
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_licence_evidence_licence ON licence_evidence(licence_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_export_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'expired', 'failed')),
  object_key TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'cancelled', 'scheduled', 'completed')),
  scheduled_for TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_security_preferences (
  user_id TEXT PRIMARY KEY,
  email_notifications INTEGER NOT NULL DEFAULT 1,
  product_notifications INTEGER NOT NULL DEFAULT 1,
  mfa_enrolled_at TEXT,
  mfa_provider TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO creator_profiles (user_id, slug, headline, bio, location, specialties_json, visibility)
VALUES ('demo-contributor', 'veld-studio', 'Documentary photography from the ground up', 'Stockvel Studio documents everyday South African stories with care, context, and clear rights.', 'Cape Town, South Africa', '["documentary", "community", "landscape"]', 'public');

INSERT OR IGNORE INTO portfolio_collections (id, organization_id, owner_id, slug, title, description, cover_asset_id, visibility)
VALUES ('portfolio-everyday-veld', 'org-demo', 'demo-contributor', 'everyday-veld', 'Everyday Stockvel', 'Grounded stories from daily life across the Western Cape.', 'asset-braai-cape-flats', 'public');
INSERT OR IGNORE INTO portfolio_collection_assets (collection_id, asset_id, sort_order) VALUES
  ('portfolio-everyday-veld', 'asset-braai-cape-flats', 1),
  ('portfolio-everyday-veld', 'asset-table-mountain', 2);

INSERT OR IGNORE INTO licence_products (code, name, description, terms_version, restrictions_json) VALUES
  ('standard', 'Standard licence', 'For digital, editorial and small business marketing use.', '2026-08', '{"seatLimit":10,"printRun":500000,"paidMedia":false,"resale":false,"aiTraining":false,"transferable":false}'),
  ('enhanced', 'Enhanced licence', 'For larger campaigns, paid media and expanded distribution.', '2026-08', '{"seatLimit":50,"printRun":10000000,"paidMedia":true,"resale":false,"aiTraining":false,"transferable":false}'),
  ('editorial', 'Editorial licence', 'For newsworthy and non-commercial editorial context only.', '2026-08', '{"commercialUse":false,"endorsement":false,"paidMedia":false,"aiTraining":false,"transferable":false}'),
  ('custom', 'Custom licence', 'A negotiated licence with a signed usage schedule.', '2026-08', '{"requiresQuote":true,"aiTraining":false,"transferable":false}');

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'contributor', 'editor', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'needs_review', 'published', 'rejected', 'withdrawn')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'South Africa',
  province TEXT,
  city TEXT,
  locality TEXT,
  landmark TEXT,
  subject_tags TEXT NOT NULL DEFAULT '[]',
  cultural_tags TEXT NOT NULL DEFAULT '[]',
  rights_status TEXT NOT NULL DEFAULT 'pending' CHECK (rights_status IN ('pending', 'verified', 'restricted', 'editorial_only')),
  model_release_status TEXT NOT NULL DEFAULT 'unknown' CHECK (model_release_status IN ('unknown', 'not_required', 'pending', 'verified')),
  property_release_status TEXT NOT NULL DEFAULT 'unknown' CHECK (property_release_status IN ('unknown', 'not_required', 'pending', 'verified')),
  authenticity_confidence REAL NOT NULL DEFAULT 0,
  human_verified INTEGER NOT NULL DEFAULT 0,
  original_key TEXT,
  preview_key TEXT,
  stream_uid TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS licences (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  licence_type TEXT NOT NULL CHECK (licence_type IN ('editorial', 'commercial', 'advertising', 'social', 'broadcast', 'exclusive')),
  territory TEXT NOT NULL DEFAULT 'worldwide',
  duration_days INTEGER NOT NULL DEFAULT 365,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'refunded', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (buyer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('sale', 'platform_fee', 'refund', 'payout')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (licence_id) REFERENCES licences(id),
  FOREIGN KEY (contributor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  asset_id TEXT,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'uploaded', 'failed', 'expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_country_city ON assets(country, city);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_licences_asset ON licences(asset_id);

INSERT OR IGNORE INTO users (id, email, display_name, role)
VALUES ('demo-contributor', 'studio@stockvel.local', 'Stockvel Studio', 'contributor');

INSERT OR IGNORE INTO users (id, email, display_name, role)
VALUES ('demo-buyer', 'creative@stockvel.local', 'Demo Creative Team', 'buyer');

INSERT OR IGNORE INTO assets (
  id, owner_id, kind, status, title, description, caption, province, city, locality, landmark,
  subject_tags, cultural_tags, rights_status, model_release_status, property_release_status,
  authenticity_confidence, human_verified
) VALUES
(
  'asset-table-mountain', 'demo-contributor', 'image', 'published',
  'Table Mountain after the Atlantic clears',
  'A verified Cape Town landscape with the mountain face opening behind the city.',
  'Table Mountain viewed from Cape Town after a clear Atlantic morning.',
  'Western Cape', 'Cape Town', 'City Bowl', 'Table Mountain',
  '["landscape","city","mountain","coast"]', '["South African landscape","Cape Town"]',
  'verified', 'not_required', 'not_required', 0.98, 1
),
(
  'asset-braai-cape-flats', 'demo-contributor', 'image', 'published',
  'Saturday braai, Cape Flats',
  'A human-verified South African braai in an everyday Cape Flats setting.',
  'Friends gather around a wood-fire braai in the Cape Flats.',
  'Western Cape', 'Cape Town', 'Mitchells Plain', NULL,
  '["people","food","community","outdoor"]', '["South African braai","wood-fire braai","Cape Flats"]',
  'verified', 'verified', 'not_required', 0.95, 1
),
(
  'asset-garden-route-drive', 'demo-contributor', 'video', 'needs_review',
  'Left-side drive through the Garden Route',
  'Road footage captured in South Africa with location metadata awaiting editor review.',
  'A right-hand-drive vehicle travels on the left side of a Garden Route road.',
  'Western Cape', 'George', 'Garden Route', 'Outeniqua Mountains',
  '["video","road","vehicle","travel"]', '["South African road","left-side traffic","right-hand-drive"]',
  'editorial_only', 'not_required', 'not_required', 0.86, 0
);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_forums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  moderation_policy TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'read_only', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS forum_threads (
  id TEXT PRIMARY KEY,
  forum_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'hidden', 'archived')),
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (forum_id) REFERENCES community_forums(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS forum_posts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'flagged', 'hidden', 'removed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS showcases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  curator_id TEXT NOT NULL,
  theme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (curator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS showcase_assets (
  showcase_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  curator_note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (showcase_id, asset_id),
  FOREIGN KEY (showcase_id) REFERENCES showcases(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS featured_collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  featured_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collection_assets (
  collection_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, asset_id),
  FOREIGN KEY (collection_id) REFERENCES featured_collections(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS takedown_requests (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  requester_id TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('copyright', 'consent', 'cultural_harm', 'privacy', 'metadata', 'other')),
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'lodged' CHECK (status IN ('lodged', 'under_review', 'mediation', 'resolved', 'appealed', 'closed')),
  response_due_at TEXT NOT NULL,
  resolution_summary TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (requester_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS mediation_sessions (
  id TEXT PRIMARY KEY,
  takedown_request_id TEXT NOT NULL UNIQUE,
  facilitator_id TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'scheduled', 'active', 'agreement_reached', 'no_agreement', 'closed')),
  ground_rules TEXT NOT NULL DEFAULT 'Listen for context, name harm precisely, and record agreed actions.',
  scheduled_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (takedown_request_id) REFERENCES takedown_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (facilitator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS mediation_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'participants' CHECK (visibility IN ('participants', 'facilitator_only', 'case_record')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES mediation_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_forum_threads_forum_activity ON forum_threads(forum_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread_activity ON forum_posts(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_showcase_assets_showcase ON showcase_assets(showcase_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_collection_assets_collection ON collection_assets(collection_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_takedown_status_due ON takedown_requests(status, response_due_at);
CREATE INDEX IF NOT EXISTS idx_takedown_asset ON takedown_requests(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mediation_messages_session ON mediation_messages(session_id, created_at ASC);

INSERT OR IGNORE INTO community_forums (id, name, description, moderation_policy) VALUES
  ('forum-practice', 'Practice & process', 'Share field notes, workflows, and hard-won lessons from making work in South Africa.', 'Respect lived experience; challenge ideas, not people.'),
  ('forum-rights', 'Rights clinic', 'Ask practical questions about releases, cultural permissions, licensing, and attribution.', 'No legal advice claims; cite sources and disclose uncertainty.'),
  ('forum-opportunities', 'Open calls & opportunities', 'Find collaborations, commissions, mentorship, and archive-led briefs.', 'Paid opportunities must show the fee or range.');

INSERT OR IGNORE INTO forum_threads (id, forum_id, author_id, title, body, featured) VALUES
  ('thread-consent', 'forum-rights', 'demo-contributor', 'How do you document consent in a public gathering?', 'A practical exchange about group portraits, context, and keeping a clear record.', 1),
  ('thread-sound', 'forum-practice', 'demo-contributor', 'Field recording in the Eastern Cape', 'What survives the wind, the taxis, and the long drive home?', 0);

INSERT OR IGNORE INTO showcases (id, title, description, curator_id, theme) VALUES
  ('showcase-after-rain', 'After the rain', 'A quiet edit of water, dust, and new light across Gauteng townships.', 'demo-contributor', 'Weather / place'),
  ('showcase-road-south', 'The long way south', 'Roads as memory: a contributor-led selection from the Karoo to the coast.', 'demo-contributor', 'Travel / movement');

INSERT OR IGNORE INTO showcase_assets (showcase_id, asset_id, sort_order) VALUES
  ('showcase-after-rain', 'asset-braai-cape-flats', 1),
  ('showcase-road-south', 'asset-garden-route-drive', 1);

INSERT OR IGNORE INTO featured_collections (id, title, description, location, featured_label) VALUES
  ('collection-waterberg', 'Waterberg field notes', 'Wildlife, farming, and the changing edges of Limpopo, documented with local context.', 'Limpopo', 'NEW / LIMPOPO'),
  ('collection-kzn-coast', 'KwaZulu-Natal coast', 'Indian Ocean mornings, working harbours, and the people who keep the coast moving.', 'KwaZulu-Natal', 'EDITOR''S PICK'),
  ('collection-joburg-after-hours', 'Joburg after hours', 'A contributor-led night collection with taxi ranks, kitchens, clubs, and soft city light.', 'Gauteng', 'COMMUNITY EDIT');

INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, sort_order) VALUES
  ('collection-waterberg', 'asset-table-mountain', 1),
  ('collection-kzn-coast', 'asset-braai-cape-flats', 1),
  ('collection-joburg-after-hours', 'asset-garden-route-drive', 1);

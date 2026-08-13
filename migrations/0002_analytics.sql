PRAGMA foreign_keys = ON;

-- Privacy-first analytics: counters are bucketed by day and never store IPs,
-- user agents, cookies, raw URLs, or a per-visitor identifier.
CREATE TABLE IF NOT EXISTS analytics_daily (
  metric_date TEXT NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('search', 'tag_click', 'asset_view', 'campaign_impression', 'campaign_conversion')),
  metric_key TEXT NOT NULL,
  asset_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_date, metric_type, metric_key, asset_id, campaign_id, country, province, city)
);

CREATE INDEX IF NOT EXISTS idx_analytics_type_date ON analytics_daily(metric_type, metric_date);
CREATE INDEX IF NOT EXISTS idx_analytics_asset ON analytics_daily(asset_id, metric_type);
CREATE INDEX IF NOT EXISTS idx_analytics_campaign ON analytics_daily(campaign_id, metric_type);

ALTER TABLE licences ADD COLUMN campaign_id TEXT NOT NULL DEFAULT '';
ALTER TABLE licences ADD COLUMN campaign_name TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO licences (id, asset_id, buyer_id, licence_type, territory, duration_days, price_cents, status, campaign_id, campaign_name)
VALUES
  ('licence-spring-asset-1', 'asset-table-mountain', 'demo-buyer', 'advertising', 'South Africa', 90, 420000, 'paid', 'campaign-spring-2026', 'Made of this place');

INSERT OR IGNORE INTO ledger_entries (id, licence_id, contributor_id, entry_type, amount_cents, currency)
VALUES
  ('ledger-spring-sale', 'licence-spring-asset-1', 'demo-contributor', 'sale', 336000, 'ZAR'),
  ('ledger-spring-fee', 'licence-spring-asset-1', 'demo-contributor', 'platform_fee', -84000, 'ZAR');

INSERT OR IGNORE INTO analytics_daily (metric_date, metric_type, metric_key, campaign_id, count)
VALUES
  ('2026-08-07', 'campaign_impression', 'campaign-spring-2026', 'campaign-spring-2026', 18200),
  ('2026-08-08', 'campaign_impression', 'campaign-spring-2026', 'campaign-spring-2026', 24100),
  ('2026-08-09', 'campaign_impression', 'campaign-spring-2026', 'campaign-spring-2026', 26700),
  ('2026-08-10', 'campaign_impression', 'campaign-spring-2026', 'campaign-spring-2026', 31800),
  ('2026-08-11', 'campaign_impression', 'campaign-spring-2026', 'campaign-spring-2026', 29400),
  ('2026-08-12', 'campaign_impression', 'campaign-spring-2026', 'campaign-spring-2026', 35600),
  ('2026-08-13', 'campaign_impression', 'campaign-spring-2026', 'campaign-spring-2026', 38200);

INSERT OR IGNORE INTO analytics_daily (metric_date, metric_type, metric_key, campaign_id, count)
VALUES
  ('2026-08-07', 'campaign_conversion', 'campaign-spring-2026', 'campaign-spring-2026', 176),
  ('2026-08-08', 'campaign_conversion', 'campaign-spring-2026', 'campaign-spring-2026', 251),
  ('2026-08-09', 'campaign_conversion', 'campaign-spring-2026', 'campaign-spring-2026', 302),
  ('2026-08-10', 'campaign_conversion', 'campaign-spring-2026', 'campaign-spring-2026', 339),
  ('2026-08-11', 'campaign_conversion', 'campaign-spring-2026', 'campaign-spring-2026', 361),
  ('2026-08-12', 'campaign_conversion', 'campaign-spring-2026', 'campaign-spring-2026', 428),
  ('2026-08-13', 'campaign_conversion', 'campaign-spring-2026', 'campaign-spring-2026', 492);

INSERT OR IGNORE INTO analytics_daily (metric_date, metric_type, metric_key, country, province, city, count)
VALUES
  ('2026-08-13', 'search', 'braai', 'South Africa', 'Western Cape', 'Cape Town', 84),
  ('2026-08-13', 'search', 'landscape', 'South Africa', 'Western Cape', 'Cape Town', 68),
  ('2026-08-13', 'search', 'left-side traffic', 'South Africa', 'Western Cape', 'George', 41),
  ('2026-08-13', 'search', 'everyday community', 'South Africa', 'Gauteng', 'Johannesburg', 33),
  ('2026-08-13', 'search', 'braai', 'South Africa', 'Western Cape', 'Cape Town', 0);

INSERT OR IGNORE INTO analytics_daily (metric_date, metric_type, metric_key, count)
VALUES
  ('2026-08-13', 'tag_click', 'South African braai', 96),
  ('2026-08-13', 'tag_click', 'Cape Town', 77),
  ('2026-08-13', 'tag_click', 'community', 61),
  ('2026-08-13', 'tag_click', 'left-side traffic', 42),
  ('2026-08-13', 'tag_click', 'Garden Route', 38);

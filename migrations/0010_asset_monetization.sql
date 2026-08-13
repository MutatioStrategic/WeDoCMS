PRAGMA foreign_keys = ON;

ALTER TABLE assets ADD COLUMN monetization_model TEXT NOT NULL DEFAULT 'membership'
  CHECK (monetization_model IN ('membership', 'individual_license', 'custom_quote'));
ALTER TABLE assets ADD COLUMN license_price_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_assets_monetization ON assets(monetization_model, status);

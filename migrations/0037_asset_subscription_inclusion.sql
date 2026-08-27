-- Sellers can decide whether an asset is included in an active Stockvel
-- membership. The seller-listed credit amount remains the fallback for buyers
-- who do not have an eligible membership, including custom-buying listings.
ALTER TABLE assets ADD COLUMN subscription_included INTEGER NOT NULL DEFAULT 0
  CHECK (subscription_included IN (0, 1));

UPDATE assets
SET subscription_included = CASE WHEN monetization_model = 'membership' THEN 1 ELSE 0 END;

CREATE INDEX IF NOT EXISTS idx_assets_subscription_included
  ON assets(status, subscription_included, updated_at DESC);

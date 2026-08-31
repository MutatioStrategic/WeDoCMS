-- Add expiry dates to credit purchases to prevent indefinite liability
-- Credits expire 12 months after purchase date

ALTER TABLE buyer_credit_purchases ADD COLUMN expires_at TEXT;
ALTER TABLE buyer_credit_purchases ADD COLUMN expired_at TEXT;

-- Set expiry dates for existing purchases (12 months from creation)
UPDATE buyer_credit_purchases 
SET expires_at = datetime(created_at, '+12 months')
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_buyer_credit_purchases_expires 
  ON buyer_credit_purchases (expires_at) WHERE status = 'paid' AND expired_at IS NULL;

-- Add discount tier tracking for bulk purchases
ALTER TABLE buyer_credit_purchases ADD COLUMN unit_price_cents INTEGER;
ALTER TABLE buyer_credit_purchases ADD COLUMN discount_tier TEXT;
ALTER TABLE buyer_credit_purchases ADD COLUMN discount_amount_cents INTEGER DEFAULT 0;

-- Update existing purchases to use standard pricing
UPDATE buyer_credit_purchases 
SET unit_price_cents = 10000, discount_tier = 'standard', discount_amount_cents = 0
WHERE unit_price_cents IS NULL;

-- Add view for active (non-expired) credits
CREATE VIEW IF NOT EXISTS buyer_active_credits AS
SELECT 
  organization_id,
  buyer_id,
  SUM(credits) AS available_credits
FROM buyer_credit_purchases
WHERE status = 'paid' 
  AND (expired_at IS NULL OR expires_at IS NULL)
  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
GROUP BY organization_id, buyer_id;

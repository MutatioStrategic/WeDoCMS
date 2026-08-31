-- Credit purchases are liability lots. Expiry is recorded on the purchase and
-- copied to its immutable ledger transaction so balance checks can exclude
-- expired lots without deleting financial history.
ALTER TABLE buyer_credit_purchases ADD COLUMN expires_at TEXT;
ALTER TABLE buyer_credit_purchases ADD COLUMN expired_at TEXT;
ALTER TABLE buyer_credit_purchases ADD COLUMN unit_price_cents INTEGER;
ALTER TABLE buyer_credit_purchases ADD COLUMN discount_tier TEXT;
ALTER TABLE buyer_credit_purchases ADD COLUMN discount_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE buyer_credit_transactions ADD COLUMN expires_at TEXT;

UPDATE buyer_credit_purchases
SET expires_at = datetime(COALESCE(paid_at, created_at), '+12 months')
WHERE status = 'paid' AND expires_at IS NULL;

UPDATE buyer_credit_purchases
SET unit_price_cents = CASE
    WHEN credits > 0 AND amount_cents % credits = 0 THEN amount_cents / credits
    ELSE 299
  END,
  discount_tier = CASE
    WHEN amount_cents = credits * 239 THEN 'enterprise'
    WHEN amount_cents = credits * 254 THEN 'platinum'
    WHEN amount_cents = credits * 269 THEN 'gold'
    WHEN amount_cents = credits * 284 THEN 'silver'
    ELSE 'standard'
  END,
  discount_amount_cents = MAX(0, (credits * 299) - amount_cents)
WHERE unit_price_cents IS NULL;

UPDATE buyer_credit_transactions
SET expires_at = (
  SELECT p.expires_at
  FROM buyer_credit_purchases p
  WHERE p.id = buyer_credit_transactions.reference_id
)
WHERE reference_type = 'credit_purchase' AND expires_at IS NULL;

-- Preserve the expiry of historical paid lots on their associated debits where
-- the old ledger did not record it. New debits select the earliest active lot
-- at write time in the Worker route.
UPDATE buyer_credit_transactions
SET expires_at = (
  SELECT MIN(p.expires_at)
  FROM buyer_credit_purchases p
  WHERE p.organization_id = buyer_credit_transactions.organization_id
    AND p.buyer_id = buyer_credit_transactions.buyer_id
    AND p.status = 'paid'
    AND p.expires_at IS NOT NULL
    AND p.expires_at > buyer_credit_transactions.created_at
)
WHERE transaction_type IN ('spend', 'refund') AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_buyer_credit_purchases_expiry
  ON buyer_credit_purchases (organization_id, buyer_id, expires_at)
  WHERE status = 'paid' AND expired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_buyer_credit_transactions_expiry
  ON buyer_credit_transactions (organization_id, buyer_id, expires_at, created_at);

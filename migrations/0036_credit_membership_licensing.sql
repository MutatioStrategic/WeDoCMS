-- Credit membership is the buyer-facing media access contract. Existing
-- licence rows keep their historical provider amount; new rows also record
-- the number of credits that unlock the selected media access.
ALTER TABLE licences ADD COLUMN credit_cost INTEGER NOT NULL DEFAULT 0 CHECK (credit_cost >= 0);
ALTER TABLE assets ADD COLUMN license_credit_cost INTEGER NOT NULL DEFAULT 100 CHECK (license_credit_cost BETWEEN 1 AND 100000);

-- 0019 encoded the old R100-per-credit assumption in a table CHECK constraint.
-- Rebuild the table so historical purchases remain intact while the provider
-- reference amount can evolve independently of the credit product.
CREATE TABLE buyer_credit_purchases_credit_v2 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 100000),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_provider TEXT,
  payment_reference TEXT,
  licence_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'wallet' CHECK (purpose IN ('wallet', 'media_access')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE SET NULL
);

INSERT INTO buyer_credit_purchases_credit_v2 (
  id, organization_id, buyer_id, credits, amount_cents, currency, status,
  payment_provider, payment_reference, paid_at, created_at, updated_at
)
SELECT id, organization_id, buyer_id, credits, amount_cents, currency, status,
  payment_provider, payment_reference, paid_at, created_at, updated_at
FROM buyer_credit_purchases;

DROP TABLE buyer_credit_purchases;
ALTER TABLE buyer_credit_purchases_credit_v2 RENAME TO buyer_credit_purchases;

CREATE INDEX IF NOT EXISTS idx_buyer_credit_purchases_buyer
  ON buyer_credit_purchases (organization_id, buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_credit_purchases_licence
  ON buyer_credit_purchases (licence_id, status);

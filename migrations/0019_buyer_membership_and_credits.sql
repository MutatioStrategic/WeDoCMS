-- Buyer membership, credit purchases, and the immutable credit movement ledger.
CREATE TABLE IF NOT EXISTS buyer_platform_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'past_due', 'cancelled')),
  price_cents INTEGER NOT NULL DEFAULT 129900,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  billing_day INTEGER NOT NULL CHECK (billing_day BETWEEN 1 AND 28),
  start_date TEXT NOT NULL,
  next_charge_date TEXT NOT NULL,
  payment_provider TEXT,
  payment_reference TEXT,
  provider_subscription_reference TEXT,
  last_payment_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, buyer_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_buyer_platform_subscription_due
  ON buyer_platform_subscriptions (status, next_charge_date);

CREATE TABLE IF NOT EXISTS buyer_credit_purchases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 100000),
  amount_cents INTEGER NOT NULL CHECK (amount_cents = credits * 10000),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_provider TEXT,
  payment_reference TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_buyer_credit_purchases_buyer
  ON buyer_credit_purchases (organization_id, buyer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS buyer_credit_transactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'spend', 'refund', 'adjustment')),
  credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_buyer_credit_transactions_buyer
  ON buyer_credit_transactions (organization_id, buyer_id, created_at DESC);

ALTER TABLE payment_webhook_events ADD COLUMN credit_purchase_id TEXT;
CREATE INDEX IF NOT EXISTS idx_payment_events_credit_purchase
  ON payment_webhook_events (credit_purchase_id, provider_event_id);

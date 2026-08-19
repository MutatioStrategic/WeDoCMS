PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buyer_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'paystack',
  plan_code TEXT NOT NULL,
  provider_subscription_code TEXT,
  provider_customer_code TEXT,
  provider_email_token TEXT,
  provider_reference TEXT,
  email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  interval TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'non-renewing', 'attention', 'completed', 'cancelled')),
  next_payment_date TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (buyer_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_subscriptions_provider_code
  ON buyer_subscriptions(provider, provider_subscription_code)
  WHERE provider_subscription_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buyer_subscriptions_buyer_status
  ON buyer_subscriptions(organization_id, buyer_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS buyer_subscription_payments (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'paystack',
  provider_event_id TEXT NOT NULL,
  provider_reference TEXT,
  invoice_code TEXT,
  event_type TEXT NOT NULL,
  amount_cents INTEGER,
  currency TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
  period_start TEXT,
  period_end TEXT,
  paid_at TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES buyer_subscriptions(id) ON DELETE CASCADE,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_subscription_payments_subscription
  ON buyer_subscription_payments(subscription_id, created_at DESC);

-- payment_webhook_events.subscription_id and its index already exist in the
-- deployed payment schema; this migration only adds the buyer subscription
-- tables and their payment history.

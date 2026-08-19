PRAGMA foreign_keys = ON;

-- Hosted Paystack links can be completed before the buyer creates an app
-- account. Keep the signed provider record by email until identity exchange
-- can attach it to a real buyer and organization.
CREATE TABLE IF NOT EXISTS buyer_subscription_claims (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'paystack',
  provider_subscription_code TEXT NOT NULL,
  provider_customer_code TEXT,
  provider_email_token TEXT,
  provider_reference TEXT,
  email TEXT NOT NULL,
  plan_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  interval TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'non-renewing', 'attention', 'completed', 'cancelled', 'claimed')),
  next_payment_date TEXT,
  failure_reason TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_subscription_code)
);

CREATE INDEX IF NOT EXISTS idx_buyer_subscription_claims_email
  ON buyer_subscription_claims(email, status, created_at DESC);

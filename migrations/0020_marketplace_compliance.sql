PRAGMA foreign_keys = OFF;

-- Existing installations used a restrictive payout-provider check. Rebuild the
-- table so Paystack subaccounts can be used without accepting raw bank details.
PRAGMA legacy_alter_table = ON;
ALTER TABLE payout_wallets RENAME TO payout_wallets_legacy;
CREATE TABLE payout_wallets (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('paystack', 'stripe_connect', 'payfast', 'za_bank')),
  provider_account_id TEXT,
  account_holder_name TEXT NOT NULL,
  account_last4 TEXT,
  branch_last4 TEXT,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  artist_share_percentage INTEGER NOT NULL DEFAULT 60 CHECK (artist_share_percentage BETWEEN 1 AND 99),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'restricted', 'disabled')),
  verified_at TEXT,
  provider_verification_reference TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contributor_id) REFERENCES users(id)
);
INSERT INTO payout_wallets (
  id, contributor_id, provider, provider_account_id, account_holder_name,
  account_last4, branch_last4, currency, status, verified_at, metadata_json,
  created_at, updated_at
)
SELECT id, contributor_id, provider, provider_account_id, account_holder_name,
  account_last4, branch_last4, currency, status, verified_at, metadata_json,
  created_at, updated_at
FROM payout_wallets_legacy;
DROP TABLE payout_wallets_legacy;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_wallet_active ON payout_wallets(contributor_id, provider)
  WHERE status <> 'disabled';

CREATE TABLE IF NOT EXISTS marketplace_agreement_acceptances (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agreement_type TEXT NOT NULL CHECK (agreement_type IN ('seller', 'buyer', 'payment')),
  agreement_version TEXT NOT NULL,
  terms_sha256 TEXT NOT NULL,
  context_type TEXT NOT NULL CHECK (context_type IN ('onboarding', 'checkout', 'listing')),
  context_id TEXT,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_marketplace_acceptances_user ON marketplace_agreement_acceptances(user_id, agreement_type, accepted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_acceptances_context ON marketplace_agreement_acceptances(user_id, agreement_type, context_type, context_id, agreement_version);

CREATE TABLE IF NOT EXISTS payment_split_allocations (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_reference TEXT,
  contributor_id TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  artist_share_percentage INTEGER NOT NULL CHECK (artist_share_percentage BETWEEN 1 AND 99),
  artist_amount_cents INTEGER NOT NULL CHECK (artist_amount_cents >= 0),
  platform_amount_cents INTEGER NOT NULL CHECK (platform_amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('configured', 'settled', 'reversed', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(licence_id),
  FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE CASCADE,
  FOREIGN KEY (contributor_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_splits_provider_ref ON payment_split_allocations(provider, provider_reference);

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;

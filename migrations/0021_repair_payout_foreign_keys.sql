-- 0020 rebuilt payout_wallets while preserving installations that had foreign
-- key checks enabled. Recreate the two dependent tables so their references
-- point at the new table rather than the temporary legacy name.
PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

ALTER TABLE onboarding_tenders RENAME TO onboarding_tenders_legacy;
CREATE TABLE onboarding_tenders (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  verification_case_id TEXT,
  wallet_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'corrections_requested')),
  review_notes TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  organization_id TEXT,
  FOREIGN KEY (contributor_id) REFERENCES users(id),
  FOREIGN KEY (contract_id) REFERENCES seller_contracts(id),
  FOREIGN KEY (verification_case_id) REFERENCES contributor_verification_cases(id),
  FOREIGN KEY (wallet_id) REFERENCES payout_wallets(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
INSERT INTO onboarding_tenders SELECT * FROM onboarding_tenders_legacy;
DROP TABLE onboarding_tenders_legacy;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_tender_pending ON onboarding_tenders(contributor_id)
  WHERE status IN ('pending', 'corrections_requested');
CREATE INDEX IF NOT EXISTS idx_onboarding_tenders_status ON onboarding_tenders(status, created_at ASC);

ALTER TABLE payout_batch_items RENAME TO payout_batch_items_legacy;
CREATE TABLE payout_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  provider_reference TEXT,
  failure_reason TEXT,
  ledger_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES payout_batches(id),
  FOREIGN KEY (contributor_id) REFERENCES users(id),
  FOREIGN KEY (wallet_id) REFERENCES payout_wallets(id),
  FOREIGN KEY (contract_id) REFERENCES seller_contracts(id),
  FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id)
);
INSERT INTO payout_batch_items SELECT * FROM payout_batch_items_legacy;
DROP TABLE payout_batch_items_legacy;
CREATE INDEX IF NOT EXISTS idx_payout_batch_items_batch ON payout_batch_items(batch_id, status);

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;

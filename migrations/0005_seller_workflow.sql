PRAGMA foreign_keys = ON;

ALTER TABLE contributor_profiles ADD COLUMN contract_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK (contract_status IN ('not_started', 'pending', 'signed', 'superseded', 'void'));
ALTER TABLE contributor_profiles ADD COLUMN active_at TEXT;

CREATE TABLE IF NOT EXISTS seller_contracts (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL,
  version TEXT NOT NULL,
  terms_snapshot TEXT NOT NULL,
  signature_method TEXT NOT NULL CHECK (signature_method IN ('firma', 'manual')),
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  content_sha256 TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'signed' CHECK (status IN ('signed', 'superseded', 'void')),
  audit_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contributor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_seller_contracts_contributor ON seller_contracts(contributor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_wallets (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('stripe_connect', 'payfast', 'za_bank')),
  provider_account_id TEXT,
  account_holder_name TEXT NOT NULL,
  account_last4 TEXT,
  branch_last4 TEXT,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'restricted', 'disabled')),
  verified_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contributor_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_wallet_active ON payout_wallets(contributor_id, provider)
  WHERE status <> 'disabled';

CREATE TABLE IF NOT EXISTS onboarding_tenders (
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
  FOREIGN KEY (contributor_id) REFERENCES users(id),
  FOREIGN KEY (contract_id) REFERENCES seller_contracts(id),
  FOREIGN KEY (verification_case_id) REFERENCES contributor_verification_cases(id),
  FOREIGN KEY (wallet_id) REFERENCES payout_wallets(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_tender_pending ON onboarding_tenders(contributor_id)
  WHERE status IN ('pending', 'corrections_requested');
CREATE INDEX IF NOT EXISTS idx_onboarding_tenders_status ON onboarding_tenders(status, created_at ASC);

CREATE TABLE IF NOT EXISTS verification_ocr_results (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'needs_review', 'failed')),
  extracted_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES verification_documents(id),
  FOREIGN KEY (case_id) REFERENCES contributor_verification_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_verification_ocr_results_case_created
  ON verification_ocr_results(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_ocr_results_document_created
  ON verification_ocr_results(document_id, created_at DESC);

ALTER TABLE verification_documents ADD COLUMN uploaded_at TEXT;
ALTER TABLE verification_documents ADD COLUMN size_bytes INTEGER;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  licence_id TEXT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale', 'refund', 'payout')),
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'pending', 'void')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (licence_id) REFERENCES licences(id)
);

CREATE TABLE IF NOT EXISTS ledger_postings (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  contributor_id TEXT,
  debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (contributor_id) REFERENCES users(id),
  CHECK ((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0))
);

CREATE INDEX IF NOT EXISTS idx_ledger_postings_contributor ON ledger_postings(contributor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_licence ON ledger_transactions(licence_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_batches (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'paid', 'failed', 'cancelled')),
  total_cents INTEGER NOT NULL DEFAULT 0,
  triggered_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  FOREIGN KEY (triggered_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payout_batch_items (
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

CREATE INDEX IF NOT EXISTS idx_payout_batch_items_batch ON payout_batch_items(batch_id, status);

PRAGMA foreign_keys = ON;

-- Seller onboarding is deliberately separate from contributor_profiles: an
-- individual/sole proprietor is not a CIPC entity, while a company is.
CREATE TABLE IF NOT EXISTS seller_onboarding_profiles (
  contributor_id TEXT PRIMARY KEY,
  seller_type TEXT NOT NULL CHECK (seller_type IN ('individual', 'company')),
  legal_name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  age_confirmed_at TEXT,
  identity_document_type TEXT NOT NULL CHECK (identity_document_type IN ('sa_id', 'passport')),
  bank_account_name TEXT NOT NULL,
  copyright_declaration_at TEXT,
  tax_responsibility_declaration_at TEXT,
  contributor_agreement_at TEXT,
  registered_name TEXT,
  cipc_registration_number TEXT,
  cipc_status TEXT NOT NULL DEFAULT 'not_checked' CHECK (cipc_status IN ('not_checked', 'pending', 'verified', 'rejected')),
  cipc_checked_at TEXT,
  representative_name TEXT,
  representative_authority_at TEXT,
  beneficial_owner_required INTEGER NOT NULL DEFAULT 0 CHECK (beneficial_owner_required IN (0, 1)),
  beneficial_owner_status TEXT NOT NULL DEFAULT 'not_required' CHECK (beneficial_owner_status IN ('not_required', 'pending', 'verified')),
  didit_session_id TEXT UNIQUE,
  didit_session_kind TEXT CHECK (didit_session_kind IN ('user', 'business')),
  didit_status TEXT NOT NULL DEFAULT 'not_started',
  didit_provider_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contributor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_seller_onboarding_didit_status ON seller_onboarding_profiles(didit_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_onboarding_cipc ON seller_onboarding_profiles(cipc_registration_number);

-- Didit retries deliveries with the same event_id. This table makes webhook
-- handling idempotent without retaining the provider's raw decision payload.
CREATE TABLE IF NOT EXISTS didit_webhook_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT,
  webhook_type TEXT NOT NULL,
  status TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

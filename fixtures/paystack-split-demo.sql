-- Synthetic local-only payment fixture. It never calls Paystack and must not be
-- used as evidence that a real provider settlement occurred.
PRAGMA foreign_keys = ON;

INSERT OR REPLACE INTO payout_wallets (
  id, contributor_id, provider, provider_account_id, account_holder_name,
  account_last4, currency, artist_share_percentage, status,
  verified_at, provider_verification_reference, metadata_json
) VALUES (
  'wallet-demo-paystack-60', 'demo-contributor', 'paystack',
  'ACCT_demo_artist_60', 'Stockvel Studio', '0000', 'ZAR', 60, 'verified',
  CURRENT_TIMESTAMP, 'demo-provider-verification-60', '{"fixture":true}'
);

INSERT OR IGNORE INTO licences (
  id, organization_id, asset_id, buyer_id, licence_type, territory,
  duration_days, price_cents, status
) VALUES (
  'licence-demo-paystack-60', 'org-demo', 'asset-table-mountain',
  'demo-buyer', 'commercial', 'South Africa', 365, 100000, 'pending'
);

UPDATE licences SET status = 'paid', payment_provider = 'paystack',
  payment_reference = 'demo-paystack-ref-60', paid_at = CURRENT_TIMESTAMP
WHERE id = 'licence-demo-paystack-60';

INSERT OR REPLACE INTO payment_split_allocations (
  id, licence_id, provider, provider_reference, contributor_id,
  provider_account_id, artist_share_percentage, artist_amount_cents,
  platform_amount_cents, currency, status
) VALUES (
  'split-demo-paystack-60', 'licence-demo-paystack-60', 'paystack',
  'demo-paystack-ref-60', 'demo-contributor', 'ACCT_demo_artist_60',
  60, 60000, 40000, 'ZAR', 'settled'
);

INSERT OR IGNORE INTO payment_webhook_events (
  id, provider, provider_event_id, event_type, licence_id, amount_cents,
  currency, payload_json, status, processed_at
) VALUES (
  'webhook-demo-paystack-60', 'paystack', 'demo-charge-success-60',
  'payment_succeeded', 'licence-demo-paystack-60', 100000, 'ZAR',
  '{"fixture":true,"event":"charge.success","data":{"reference":"demo-paystack-ref-60","amount":100000,"currency":"ZAR"}}',
  'processed', CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ledger_transactions (
  id, licence_id, transaction_type, idempotency_key, amount_cents, currency
) VALUES (
  'txn-demo-paystack-sale-60', 'licence-demo-paystack-60', 'sale',
  'fixture:paystack:demo-charge-success-60', 100000, 'ZAR'
);

INSERT OR IGNORE INTO ledger_postings (
  id, transaction_id, account_code, debit_cents, credit_cents, metadata_json
) VALUES
  ('posting-demo-paystack-cash-60', 'txn-demo-paystack-sale-60', 'cash_clearing', 100000, 0, '{"fixture":true}'),
  ('posting-demo-paystack-artist-60', 'txn-demo-paystack-sale-60', 'contributor_payable', 0, 60000, '{"fixture":true,"artistSharePercentage":60}'),
  ('posting-demo-paystack-platform-60', 'txn-demo-paystack-sale-60', 'platform_revenue', 0, 40000, '{"fixture":true,"platformSharePercentage":40}');

INSERT OR IGNORE INTO ledger_entries (
  id, licence_id, contributor_id, entry_type, amount_cents, currency
) VALUES
  ('entry-demo-paystack-sale-60', 'licence-demo-paystack-60', 'demo-contributor', 'sale', 60000, 'ZAR'),
  ('entry-demo-paystack-fee-60', 'licence-demo-paystack-60', 'demo-contributor', 'platform_fee', -40000, 'ZAR');

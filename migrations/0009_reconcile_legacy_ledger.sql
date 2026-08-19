-- Bridge legacy licence ledger entries into the transaction ledger used by
-- reconciliation and settlement operations. The guards make this safe to run
-- against databases that already have the canonical transaction rows.
INSERT OR IGNORE INTO ledger_transactions (id, licence_id, transaction_type, idempotency_key, amount_cents, currency, status)
SELECT
  'legacy-sale-' || le.licence_id,
  le.licence_id,
  'sale',
  'legacy:ledger-entry:' || le.id,
  l.price_cents,
  le.currency,
  'posted'
FROM ledger_entries le
JOIN licences l ON l.id = le.licence_id
WHERE le.entry_type = 'sale'
  AND l.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM ledger_transactions lt WHERE lt.licence_id = le.licence_id AND lt.transaction_type = 'sale');

INSERT OR IGNORE INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json)
SELECT 'legacy-sale-cash-' || le.licence_id, 'legacy-sale-' || le.licence_id, 'cash_clearing', l.price_cents, 0, '{"source":"legacy_ledger_bridge"}'
FROM ledger_entries le
JOIN licences l ON l.id = le.licence_id
WHERE le.entry_type = 'sale' AND l.status = 'paid'
  AND EXISTS (SELECT 1 FROM ledger_transactions lt WHERE lt.id = 'legacy-sale-' || le.licence_id);

INSERT OR IGNORE INTO ledger_postings (id, transaction_id, account_code, contributor_id, debit_cents, credit_cents, metadata_json)
SELECT 'legacy-sale-contributor-' || le.licence_id, 'legacy-sale-' || le.licence_id, 'contributor_payable', le.contributor_id, 0, le.amount_cents, '{"source":"legacy_ledger_bridge"}'
FROM ledger_entries le
JOIN licences l ON l.id = le.licence_id
WHERE le.entry_type = 'sale' AND l.status = 'paid'
  AND le.amount_cents > 0
  AND EXISTS (SELECT 1 FROM ledger_transactions lt WHERE lt.id = 'legacy-sale-' || le.licence_id);

INSERT OR IGNORE INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents, metadata_json)
SELECT 'legacy-sale-platform-' || le.licence_id, 'legacy-sale-' || le.licence_id, 'platform_revenue', 0, l.price_cents - le.amount_cents, '{"source":"legacy_ledger_bridge"}'
FROM ledger_entries le
JOIN licences l ON l.id = le.licence_id
WHERE le.entry_type = 'sale' AND l.status = 'paid'
  AND l.price_cents > le.amount_cents
  AND EXISTS (SELECT 1 FROM ledger_transactions lt WHERE lt.id = 'legacy-sale-' || le.licence_id);

$ErrorActionPreference = "Stop"
$persistPath = ".veld-archive-migrations-" + [guid]::NewGuid().ToString("N")
$resolvedPersistPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $persistPath))
$resolvedWorkspacePath = [System.IO.Path]::GetFullPath((Get-Location).Path)
if (-not $resolvedPersistPath.StartsWith($resolvedWorkspacePath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use a migration test path outside the workspace: $resolvedPersistPath"
}

function Invoke-D1Json([string]$query) {
  $output = & npx wrangler d1 execute veld-archive --local --persist-to $persistPath --command $query --json 2>&1
  if ($LASTEXITCODE -ne 0) { throw "D1 query failed: $query`n$($output -join "`n")" }
  $text = [string]::Join("`n", [string[]]$output)
  $jsonStart = $text.IndexOf("[")
  if ($jsonStart -lt 0) { throw "D1 query did not return JSON: $query`n$text" }
  return (($text.Substring($jsonStart) | ConvertFrom-Json)[0].results)
}

function Invoke-D1ExpectedFailure([string]$query) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & npx wrangler d1 execute veld-archive --local --persist-to $persistPath --command $query 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -eq 0) { throw "Expected D1 query to fail, but it succeeded: $query`n$($output -join "`n")" }
}

try {
  npx wrangler d1 migrations apply veld-archive --local --persist-to $persistPath

  $tables = @(Invoke-D1Json "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('organizations','organization_memberships','auth_sessions','notifications','rate_limit_buckets','media_scan_results','payment_webhook_events','payment_reconciliation_runs','rights_case_events','ops_actions','asset_search_fts','photo_ai_provenance','buyer_platform_subscriptions','buyer_credit_purchases','buyer_credit_transactions') ORDER BY name")
  foreach ($required in @("organizations", "organization_memberships", "auth_sessions", "payment_webhook_events", "rights_case_events", "asset_search_fts", "photo_ai_provenance", "buyer_platform_subscriptions", "buyer_credit_purchases", "buyer_credit_transactions")) {
    if (-not ($tables.name -contains $required)) { throw "Required migrated table missing: $required" }
  }

  Invoke-D1Json "INSERT INTO buyer_credit_purchases (id, organization_id, buyer_id, credits, amount_cents) VALUES ('credit-model-test', 'org-demo', 'demo-buyer', 3, 30000)" | Out-Null
  Invoke-D1ExpectedFailure "INSERT INTO buyer_credit_purchases (id, organization_id, buyer_id, credits, amount_cents) VALUES ('credit-model-invalid', 'org-demo', 'demo-buyer', 3, 29900)"
  Invoke-D1ExpectedFailure "INSERT INTO buyer_platform_subscriptions (id, organization_id, buyer_id, billing_day, start_date, next_charge_date) VALUES ('membership-model-invalid-day', 'org-demo', 'demo-buyer', 31, '2026-09-01', '2026-10-01')"

  $seed = @(Invoke-D1Json "SELECT status, workflow_stage, organization_id, monetization_model FROM assets WHERE id = 'asset-table-mountain'")[0]
  if ($seed.status -ne "published" -or $seed.workflow_stage -ne "approval" -or $seed.organization_id -ne "org-demo" -or $seed.monetization_model -ne "membership") {
    throw "Seeded asset model state is invalid: $($seed | ConvertTo-Json -Compress)"
  }
  $ftsMatch = @(Invoke-D1Json "SELECT a.id FROM asset_search_fts JOIN assets a ON a.id = asset_search_fts.asset_id AND a.approved_revision = CAST(asset_search_fts.revision AS INTEGER) WHERE asset_search_fts MATCH 'Table' LIMIT 1")[0]
  if ($ftsMatch.id -ne "asset-table-mountain") { throw "Approved asset was not available through the revision-pinned FTS index" }

  Invoke-D1Json "INSERT INTO organizations (id, name, slug) VALUES ('org-model-test', 'Model Test', 'model-test')" | Out-Null
  Invoke-D1Json "INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ('membership-model-test', 'org-model-test', 'demo-buyer', 'buyer')" | Out-Null
  Invoke-D1ExpectedFailure "INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ('membership-model-duplicate', 'org-model-test', 'demo-buyer', 'buyer')"
  Invoke-D1ExpectedFailure "INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ('membership-model-invalid', 'org-model-test', 'demo-buyer', 'owner')"
  Invoke-D1ExpectedFailure "INSERT INTO assets (id, owner_id, kind, title) VALUES ('asset-model-invalid', 'demo-contributor', 'audio', 'Invalid model asset')"

  Invoke-D1Json "INSERT INTO payment_webhook_events (id, provider, provider_event_id, event_type, payload_json) VALUES ('event-model-1', 'test', 'provider-event-model-1', 'payment.succeeded', '{}')" | Out-Null
  Invoke-D1ExpectedFailure "INSERT INTO payment_webhook_events (id, provider, provider_event_id, event_type, payload_json) VALUES ('event-model-2', 'test', 'provider-event-model-1', 'payment.succeeded', '{}')"

  Invoke-D1Json "INSERT INTO ledger_transactions (id, transaction_type, idempotency_key, amount_cents) VALUES ('transaction-model-1', 'sale', 'model-sale-1', 1000)" | Out-Null
  Invoke-D1Json "INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents) VALUES ('posting-model-1', 'transaction-model-1', 'cash', 1000)" | Out-Null
  Invoke-D1ExpectedFailure "INSERT INTO ledger_postings (id, transaction_id, account_code, debit_cents, credit_cents) VALUES ('posting-model-both', 'transaction-model-1', 'invalid', 100, 100)"
  Invoke-D1ExpectedFailure "INSERT INTO ledger_postings (id, transaction_id, account_code) VALUES ('posting-model-neither', 'transaction-model-1', 'invalid')"

  Invoke-D1Json "INSERT INTO photo_ai_jobs (id, asset_id, operation, asset_revision) VALUES ('job-model-1', 'asset-table-mountain', 'enrich', 1)" | Out-Null
  Invoke-D1ExpectedFailure "INSERT INTO photo_ai_jobs (id, asset_id, operation, asset_revision) VALUES ('job-model-2', 'asset-table-mountain', 'enrich', 1)"

  Invoke-D1Json "INSERT INTO audit_chain_heads (stream_id, sequence, head_hash) VALUES ('stream-model-1', 0, 'root')" | Out-Null
  $auditInsert = "INSERT INTO audit_log_events (event_id, stream_id, sequence, occurred_at, actor_id, actor_type, action, resource_type, resource_id, residency_region, previous_hash, event_hash, signature, key_id, public_key_jwk, canonical_json, r2_key) VALUES ('event-model-audit-1', 'stream-model-1', 1, '2026-01-01T00:00:00Z', 'demo-admin', 'admin', 'asset.approved', 'asset', 'asset-table-mountain', 'za', 'root', 'hash-model-1', 'signature', 'key-1', '{}', '{}', 'audit/stream-model-1/1')"
  Invoke-D1Json $auditInsert | Out-Null
  Invoke-D1ExpectedFailure "UPDATE audit_log_events SET action = 'asset.rejected' WHERE event_id = 'event-model-audit-1'"
  Invoke-D1ExpectedFailure "DELETE FROM audit_log_events WHERE event_id = 'event-model-audit-1'"
  Invoke-D1ExpectedFailure ($auditInsert.Replace("event-model-audit-1", "event-model-audit-2").Replace("1, '2026-01-01", "2, '2026-01-01").Replace("'root', 'hash-model-1'", "'wrong-root', 'hash-model-2'").Replace("audit/stream-model-1/1", "audit/stream-model-1/2"))

  Write-Host "Migration model smoke test passed."
}
finally {
  if (Test-Path -LiteralPath $resolvedPersistPath) {
    Remove-Item -LiteralPath $resolvedPersistPath -Recurse -Force
  }
}

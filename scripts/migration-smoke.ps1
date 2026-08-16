$ErrorActionPreference = "Stop"
npx wrangler d1 migrations apply veld-archive --local
$query = "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('organizations','organization_memberships','auth_sessions','notifications','rate_limit_buckets','media_scan_results','payment_webhook_events','payment_reconciliation_runs','rights_case_events','ops_actions','user_lightboxes','user_lightbox_members','licence_downloads','saved_searches','creator_profiles','portfolio_collections','asset_events','media_processing_jobs','licence_products','account_export_jobs') ORDER BY name"
$result = npx wrangler d1 execute veld-archive --local --command $query | Out-String
foreach ($required in @("organizations", "organization_memberships", "auth_sessions", "payment_webhook_events", "rights_case_events", "user_lightboxes", "user_lightbox_members", "licence_downloads", "saved_searches", "creator_profiles", "portfolio_collections", "asset_events", "media_processing_jobs", "licence_products", "account_export_jobs")) {
  if ($result -notmatch $required) { throw "Required migrated table missing: $required" }
}
Write-Host "Migration smoke test passed."

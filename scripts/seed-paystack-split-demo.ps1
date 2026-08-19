$ErrorActionPreference = "Stop"

<##
Seeds a synthetic, local-only Paystack split settlement for demo-buyer and
demo-contributor. No Paystack request is made and no real money moves.
#>

$root = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $root "fixtures\paystack-split-demo.sql"

Write-Host "Applying local D1 migrations..."
npx wrangler d1 migrations apply veld-archive --local
if ($LASTEXITCODE -ne 0) { throw "Local D1 migration failed." }

Write-Host "Seeding synthetic Paystack 60/40 settlement..."
npx wrangler d1 execute veld-archive --local --file $fixture
if ($LASTEXITCODE -ne 0) { throw "Paystack split fixture failed." }

$query = "SELECT l.id AS licence_id, l.status AS licence_status, l.price_cents, s.artist_share_percentage, s.artist_amount_cents, s.platform_amount_cents, s.status AS split_status, w.provider_account_id FROM licences l JOIN payment_split_allocations s ON s.licence_id = l.id JOIN payout_wallets w ON w.id = 'wallet-demo-paystack-60' WHERE l.id = 'licence-demo-paystack-60'"
npx wrangler d1 execute veld-archive --local --command $query
if ($LASTEXITCODE -ne 0) { throw "Paystack split fixture verification failed." }

Write-Host "Synthetic fixture ready: R1,000 buyer payment; R600 artist share; R400 platform share."

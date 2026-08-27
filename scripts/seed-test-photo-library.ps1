param(
  [switch]$Remote
)

$ErrorActionPreference = "Stop"

<##
Seeds exactly 100 searchable photo records. Local is the default; pass -Remote
only when deliberately promoting the records to the configured Cloudflare account.

The records intentionally have no media preview. Their metadata is synthetic
and is only meant to exercise prompt search, result ranking, filters, and the
empty state; it must not be promoted to production.
#>

$root = Split-Path -Parent $PSScriptRoot
$storageFlag = if ($Remote) { "--remote" } else { "--local" }
$targetLabel = if ($Remote) { "remote Cloudflare" } else { "local Wrangler" }
function Invoke-D1([string]$sql) {
  & npx.cmd wrangler d1 execute veld-archive $storageFlag --command $sql
  if ($LASTEXITCODE -ne 0) { throw "D1 command failed." }
}

function Invoke-D1File([string]$path) {
  & npx.cmd wrangler d1 execute veld-archive $storageFlag --file $path --yes
  if ($LASTEXITCODE -ne 0) { throw "D1 SQL file failed." }
}

function Invoke-D1Json([string]$sql) {
  $output = & npx.cmd wrangler d1 execute veld-archive $storageFlag --command $sql --json 2>&1
  if ($LASTEXITCODE -ne 0) { throw "D1 JSON query failed: $sql`n$($output -join "`n")" }
  $text = [string]::Join("`n", [string[]]$output)
  $jsonStart = $text.IndexOf("[")
  if ($jsonStart -lt 0) { throw "D1 query did not return JSON: $sql`n$text" }
  return (($text.Substring($jsonStart) | ConvertFrom-Json)[0].results)
}

$demoSeedArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $root "scripts\seed-demo-media.ps1"))
if ($Remote) { $demoSeedArgs += "-Remote" }
Write-Host "Seeding the existing demo media fixtures into $targetLabel..."
& powershell.exe @demoSeedArgs
if ($LASTEXITCODE -ne 0) { throw "Demo media fixtures could not be prepared." }

$sql = @'
PRAGMA foreign_keys = ON;

WITH RECURSIVE numbers(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM numbers WHERE n < 100
)
INSERT OR IGNORE INTO assets (
  id, organization_id, owner_id, kind, status, title, description, caption,
  country, province, city, locality, landmark, subject_tags, cultural_tags,
  rights_status, model_release_status, property_release_status,
  authenticity_confidence, human_verified, original_key, preview_key,
  workflow_stage, ai_tags, curator_notes, metadata_review_status,
  metadata_review_note, metadata_provenance, source_file_name, source_license,
  source_attribution, demo_seed, asset_revision, reviewed_revision,
  approved_revision, visual_location_type, primary_category, scene_attributes,
  geographic_location_source
)
SELECT
  'asset-test-photo-' || printf('%03d', n), 'org-demo', 'demo-contributor',
  'image', 'published',
  CASE ((n - 1) % 10)
    WHEN 0 THEN 'Street cat in Cape Town ' || printf('%03d', n)
    WHEN 1 THEN 'Drakensberg mountain light ' || printf('%03d', n)
    WHEN 2 THEN 'Indian Ocean shoreline ' || printf('%03d', n)
    WHEN 3 THEN 'Soweto market morning ' || printf('%03d', n)
    WHEN 4 THEN 'Garden Route road ' || printf('%03d', n)
    WHEN 5 THEN 'Johannesburg brick facade ' || printf('%03d', n)
    WHEN 6 THEN 'Cape Flats braai table ' || printf('%03d', n)
    WHEN 7 THEN 'Kruger savanna grassland ' || printf('%03d', n)
    WHEN 8 THEN 'Mamelodi football field ' || printf('%03d', n)
    ELSE 'Craft studio still life ' || printf('%03d', n)
  END,
  CASE ((n - 1) % 10)
    WHEN 0 THEN 'Synthetic search fixture describing a neighbourhood cat in Cape Town.'
    WHEN 1 THEN 'Synthetic search fixture describing a mountain landscape in KwaZulu-Natal.'
    WHEN 2 THEN 'Synthetic search fixture describing a coastal landscape near Durban.'
    WHEN 3 THEN 'Synthetic search fixture describing a food market in Johannesburg.'
    WHEN 4 THEN 'Synthetic search fixture describing a road journey through the Garden Route.'
    WHEN 5 THEN 'Synthetic search fixture describing an urban architecture detail in Johannesburg.'
    WHEN 6 THEN 'Synthetic search fixture describing a communal food scene in Cape Town.'
    WHEN 7 THEN 'Synthetic search fixture describing wildlife habitat in Mpumalanga.'
    WHEN 8 THEN 'Synthetic search fixture describing a community sport field in Tshwane.'
    ELSE 'Synthetic search fixture describing handmade objects in a Cape Town studio.'
  END,
  CASE ((n - 1) % 10)
    WHEN 0 THEN 'A neighbourhood cat rests in a Cape Town street setting.'
    WHEN 1 THEN 'Mountain ridges catch early light in the Drakensberg.'
    WHEN 2 THEN 'An Indian Ocean shoreline near Durban, South Africa.'
    WHEN 3 THEN 'A busy market morning in Soweto, Johannesburg.'
    WHEN 4 THEN 'A road through the Garden Route landscape.'
    WHEN 5 THEN 'A brick facade and geometric shadows in Johannesburg.'
    WHEN 6 THEN 'A shared braai table in the Cape Flats.'
    WHEN 7 THEN 'Open savanna and acacia trees near Kruger National Park.'
    WHEN 8 THEN 'A local football field in Mamelodi, Tshwane.'
    ELSE 'Handmade craft objects arranged in a Cape Town studio.'
  END,
  'South Africa',
  CASE ((n - 1) % 10) WHEN 0 THEN 'Western Cape' WHEN 1 THEN 'KwaZulu-Natal' WHEN 2 THEN 'KwaZulu-Natal' WHEN 3 THEN 'Gauteng' WHEN 4 THEN 'Western Cape' WHEN 5 THEN 'Gauteng' WHEN 6 THEN 'Western Cape' WHEN 7 THEN 'Mpumalanga' WHEN 8 THEN 'Gauteng' ELSE 'Western Cape' END,
  CASE ((n - 1) % 10) WHEN 0 THEN 'Cape Town' WHEN 1 THEN 'Bergville' WHEN 2 THEN 'Durban' WHEN 3 THEN 'Johannesburg' WHEN 4 THEN 'George' WHEN 5 THEN 'Johannesburg' WHEN 6 THEN 'Cape Town' WHEN 7 THEN 'Skukuza' WHEN 8 THEN 'Pretoria' ELSE 'Cape Town' END,
  CASE ((n - 1) % 10) WHEN 0 THEN 'Bo-Kaap' WHEN 1 THEN 'Drakensberg' WHEN 2 THEN 'Umhlanga' WHEN 3 THEN 'Soweto' WHEN 4 THEN 'Garden Route' WHEN 5 THEN 'Maboneng' WHEN 6 THEN 'Mitchells Plain' WHEN 7 THEN 'Kruger National Park' WHEN 8 THEN 'Mamelodi' ELSE 'Woodstock' END,
  CASE ((n - 1) % 10) WHEN 1 THEN 'Drakensberg Mountains' WHEN 2 THEN 'Indian Ocean' WHEN 4 THEN 'Outeniqua Mountains' WHEN 7 THEN 'Kruger National Park' ELSE NULL END,
  CASE ((n - 1) % 10) WHEN 0 THEN '["cat","animal","street","pet"]' WHEN 1 THEN '["mountain","landscape","hiking","nature"]' WHEN 2 THEN '["ocean","coast","beach","landscape"]' WHEN 3 THEN '["market","food","street","community"]' WHEN 4 THEN '["road","travel","driving","landscape"]' WHEN 5 THEN '["architecture","building","urban","facade"]' WHEN 6 THEN '["food","braai","community","outdoor"]' WHEN 7 THEN '["wildlife","savanna","trees","landscape"]' WHEN 8 THEN '["football","sport","community","field"]' ELSE '["craft","objects","studio","design"]' END,
  CASE ((n - 1) % 10) WHEN 0 THEN '["Cape Town","urban wildlife"]' WHEN 1 THEN '["KwaZulu-Natal","South African landscape"]' WHEN 2 THEN '["Durban","KwaZulu-Natal coast"]' WHEN 3 THEN '["Soweto","Johannesburg","South African everyday life"]' WHEN 4 THEN '["Garden Route","South African road life"]' WHEN 5 THEN '["Johannesburg","urban South Africa"]' WHEN 6 THEN '["South African braai","Cape Flats","Cape Town"]' WHEN 7 THEN '["Mpumalanga","South African nature"]' WHEN 8 THEN '["Mamelodi","Tshwane","South African sport"]' ELSE '["Cape Town","South African design"]' END,
  'editorial_only', 'not_required', 'not_required', 1, 1,
  NULL,
  NULL,
  'approval',
  CASE ((n - 1) % 10) WHEN 0 THEN '["cat","animal","street","pet"]' WHEN 1 THEN '["mountain","landscape","hiking","nature"]' WHEN 2 THEN '["ocean","coast","beach","landscape"]' WHEN 3 THEN '["market","food","street","community"]' WHEN 4 THEN '["road","travel","driving","landscape"]' WHEN 5 THEN '["architecture","building","urban","facade"]' WHEN 6 THEN '["food","braai","community","outdoor"]' WHEN 7 THEN '["wildlife","savanna","trees","landscape"]' WHEN 8 THEN '["football","sport","community","field"]' ELSE '["craft","objects","studio","design"]' END,
  'Local-only synthetic search fixture. Do not publish or license.',
  'reviewed', 'Synthetic metadata used to exercise prompt search and empty results.',
  'editor',
  NULL,
  'Local test fixture', 'Stockvel development team', 0, 1, 1, 1,
  CASE ((n - 1) % 10) WHEN 0 THEN 'urban_street' WHEN 1 THEN 'rural_landscape' WHEN 2 THEN 'coastal_landscape' WHEN 3 THEN 'market_scene' WHEN 4 THEN 'transport' WHEN 5 THEN 'urban_street' WHEN 6 THEN 'food' WHEN 7 THEN 'nature' WHEN 8 THEN 'sports' ELSE 'indoor' END,
  CASE ((n - 1) % 10) WHEN 0 THEN 'nature' WHEN 1 THEN 'nature' WHEN 2 THEN 'travel' WHEN 3 THEN 'food' WHEN 4 THEN 'travel' WHEN 5 THEN 'architecture' WHEN 6 THEN 'food' WHEN 7 THEN 'nature' WHEN 8 THEN 'sport' ELSE 'arts_culture' END,
  '["synthetic test metadata"]',
  'editor'
FROM numbers;

DELETE FROM asset_search_fts WHERE asset_id LIKE 'asset-test-photo-%';
INSERT INTO asset_search_fts (
  document_id, asset_id, revision, title, description, caption, subject_tags,
  context_tags, visible_text, location_type, category, scene_attributes,
  geographic_context
)
SELECT
  id || '::r' || asset_revision, id, asset_revision, title, description,
  caption, replace(replace(subject_tags, '[', ' '), ']', ' '),
  replace(replace(cultural_tags, '[', ' '), ']', ' '), ocr_text,
  replace(visual_location_type, '_', ' '), replace(primary_category, '_', ' '),
  replace(replace(scene_attributes, '[', ' '), ']', ' '),
  trim(COALESCE(country, '') || ' ' || COALESCE(province, '') || ' ' || COALESCE(city, '') || ' ' || COALESCE(locality, '') || ' ' || COALESCE(landmark, ''))
FROM assets
WHERE id LIKE 'asset-test-photo-%';
'@

$sqlPath = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($sqlPath, $sql, [System.Text.UTF8Encoding]::new($false))
  Invoke-D1File $sqlPath
}
finally {
  if (Test-Path -LiteralPath $sqlPath) { Remove-Item -LiteralPath $sqlPath -Force }
}

$count = @(Invoke-D1Json "SELECT COUNT(*) AS count FROM assets WHERE id LIKE 'asset-test-photo-%'")[0]
if ([int]$count.count -ne 100) { throw "Expected 100 test photo records, found $($count.count)." }

$mediaMatches = @(Invoke-D1Json "SELECT COUNT(*) AS count FROM assets WHERE id LIKE 'asset-test-photo-%' AND (source_file_name IS NOT NULL OR original_key IS NOT NULL OR preview_key IS NOT NULL)")[0]
if ([int]$mediaMatches.count -ne 0) { throw "Synthetic test records must not reference unrelated media previews." }

$catMatches = @(Invoke-D1Json "SELECT COUNT(*) AS count FROM asset_search_fts WHERE asset_search_fts MATCH 'cat'")[0]
if ([int]$catMatches.count -lt 1) { throw "FTS verification failed: cat returned no test matches." }

$xyzMatches = @(Invoke-D1Json "SELECT COUNT(*) AS count FROM asset_search_fts WHERE asset_search_fts MATCH 'xyz'")[0]
if ([int]$xyzMatches.count -ne 0) { throw "Empty-state verification failed: xyz unexpectedly matched test data." }

Write-Host "$targetLabel test photo library ready: 100 records, no media previews, $($catMatches.count) cat matches, 0 xyz matches."

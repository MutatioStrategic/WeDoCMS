param(
  [Parameter(Mandatory = $true)][string]$DbName,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [switch]$Remote,
  [switch]$Local
)

$ErrorActionPreference = "Stop"
if ($Remote -eq $Local) { throw "Specify exactly one of -Remote or -Local." }

$scopeFlag = if ($Remote) { "--remote" } else { "--local" }
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

function Invoke-D1Json([string]$query) {
  $output = & npx.cmd wrangler d1 execute $DbName $scopeFlag --command $query --json 2>&1
  if ($LASTEXITCODE -ne 0) { throw "D1 query failed: $query`n$($output -join "`n")" }
  $text = [string]::Join("`n", [string[]]$output)
  $jsonStart = $text.IndexOf("[")
  if ($jsonStart -lt 0) { throw "D1 query did not return JSON: $query`n$text" }
  $parsed = $text.Substring($jsonStart) | ConvertFrom-Json
  return @($parsed[0].results)
}

function Invoke-D1Export([string[]]$tableNames) {
  $exportArgs = @("d1", "export", $DbName, $scopeFlag, "--skip-confirmation", "--output", $resolvedOutput)
  foreach ($tableName in $tableNames) { $exportArgs += @("--table", $tableName) }
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $commandOutput = & npx.cmd wrangler @exportArgs 2>&1
    $exitCode = $LASTEXITCODE
    $commandOutput | ForEach-Object { Write-Host $_ }
    return $exitCode
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

$normalExit = Invoke-D1Export @()
if ($normalExit -eq 0) {
  Write-Host "D1 export completed with the native Wrangler exporter: $resolvedOutput"
  exit 0
}

if (Test-Path -LiteralPath $resolvedOutput) { Remove-Item -LiteralPath $resolvedOutput -Force }
Write-Host "Native D1 export cannot serialize the FTS5 virtual table; exporting base tables and rebuilding the search index."

$tables = @(Invoke-D1Json "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'asset_search_fts%' ORDER BY name")
$tableNames = @($tables | ForEach-Object { [string]$_.name } | Where-Object { $_ })
if (-not $tableNames.Count) { throw "No exportable D1 tables were found." }

$fallbackExit = Invoke-D1Export $tableNames
if ($fallbackExit -ne 0) { throw "D1 table-scoped export failed" }

$ftsRebuild = @'

-- Veld Archive restore hook: rebuild the FTS5 virtual table after base-table restore.
PRAGMA foreign_keys = OFF;
CREATE VIRTUAL TABLE IF NOT EXISTS asset_search_fts USING fts5(
  document_id UNINDEXED,
  asset_id UNINDEXED,
  revision UNINDEXED,
  title,
  description,
  caption,
  subject_tags,
  context_tags,
  visible_text,
  location_type,
  category,
  scene_attributes,
  geographic_context,
  tokenize = 'unicode61 remove_diacritics 2'
);
DELETE FROM asset_search_fts;
INSERT INTO asset_search_fts (
  document_id, asset_id, revision, title, description, caption, subject_tags,
  context_tags, visible_text, location_type, category, scene_attributes,
  geographic_context
)
SELECT
  id || '::r' || asset_revision,
  id,
  asset_revision,
  title,
  description,
  caption,
  replace(replace(subject_tags, '[', ' '), ']', ' '),
  replace(replace(cultural_tags, '[', ' '), ']', ' '),
  ocr_text,
  replace(visual_location_type, '_', ' '),
  replace(primary_category, '_', ' '),
  replace(replace(scene_attributes, '[', ' '), ']', ' '),
  trim(COALESCE(country, '') || ' ' || COALESCE(province, '') || ' ' || COALESCE(city, '') || ' ' || COALESCE(locality, '') || ' ' || COALESCE(landmark, ''))
FROM assets
WHERE status = 'published';
PRAGMA foreign_keys = ON;
'@
[System.IO.File]::AppendAllText($resolvedOutput, $ftsRebuild, [System.Text.UTF8Encoding]::new($false))
Write-Host "D1 export completed with FTS5 rebuild hook: $resolvedOutput"

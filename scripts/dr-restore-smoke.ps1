param(
  [string]$DbName = "veld-archive",
  [string]$BackupSql
)

$ErrorActionPreference = "Stop"
$workspace = (Get-Location).Path
$scratch = Join-Path $workspace ".dr-restore-smoke"
if (Test-Path -LiteralPath $scratch) { throw "Refusing to reuse an existing DR scratch directory: $scratch" }
New-Item -ItemType Directory -Path $scratch | Out-Null

try {
  $sqlPath = if ($BackupSql) { [System.IO.Path]::GetFullPath($BackupSql) } else { Join-Path $scratch "$DbName.sql" }
  if (-not $BackupSql) {
    Write-Host "Exporting isolated local D1 backup for restore verification"
    & npx wrangler d1 export $DbName --local --output $sqlPath
    if ($LASTEXITCODE -ne 0) { throw "Local D1 export failed" }
  }
  if (-not (Test-Path -LiteralPath $sqlPath -PathType Leaf)) { throw "Backup SQL file was not found: $sqlPath" }

  $sqlite = (Get-Command sqlite3 -ErrorAction Stop).Source
  $restoreDb = Join-Path $scratch "restored.sqlite"
  & $sqlite $restoreDb ".read '$sqlPath'"
  if ($LASTEXITCODE -ne 0) { throw "SQLite restore failed" }
  $integrity = (& $sqlite $restoreDb "PRAGMA integrity_check;").Trim()
  if ($integrity -ne "ok") { throw "Restored database integrity check failed: $integrity" }
  $tables = (& $sqlite $restoreDb "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users','organizations','licences','payment_webhook_events');").Trim()
  if ([int]$tables -ne 4) { throw "Restored database is missing required production tables" }
  Write-Host "DR restore smoke passed: isolated restore is structurally valid"
} finally {
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}

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
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "export-d1.ps1") -DbName $DbName -OutputPath $sqlPath -Local
    if ($LASTEXITCODE -ne 0) { throw "Local D1 export failed" }
  }
  if (-not (Test-Path -LiteralPath $sqlPath -PathType Leaf)) { throw "Backup SQL file was not found: $sqlPath" }

  $restoreDb = Join-Path $scratch "restored.sqlite"
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    & $python.Source (Join-Path $PSScriptRoot "validate-d1-restore.py") --sql $sqlPath --database $restoreDb
    if ($LASTEXITCODE -ne 0) { throw "Python SQLite restore failed" }
  } else {
    $sqlite = (Get-Command sqlite3 -ErrorAction Stop).Source
    & $sqlite $restoreDb ".read '$sqlPath'"
    if ($LASTEXITCODE -ne 0) { throw "SQLite restore failed; install SQLite with FTS5 support or Python 3" }
    $integrity = (& $sqlite $restoreDb "PRAGMA integrity_check;").Trim()
    if ($integrity -ne "ok") { throw "Restored database integrity check failed: $integrity" }
    $tables = (& $sqlite $restoreDb "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users','organizations','licences','payment_webhook_events');").Trim()
    if ([int]$tables -ne 4) { throw "Restored database is missing required production tables" }
    Write-Host "DR restore smoke passed: isolated restore is structurally valid (FTS5 search verification unavailable without Python)"
  }
} finally {
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}

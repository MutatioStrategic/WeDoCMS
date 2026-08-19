param(
  [string]$BackupSql,
  [string]$Manifest
)

$ErrorActionPreference = "Stop"
$temporaryFixture = $false
if (-not $BackupSql) {
  $BackupSql = [System.IO.Path]::GetTempFileName()
  $temporaryFixture = $true
  @"
CREATE TABLE users (id TEXT PRIMARY KEY);
CREATE TABLE organizations (id TEXT PRIMARY KEY);
CREATE TABLE licences (id TEXT PRIMARY KEY);
"@ | Set-Content -LiteralPath $BackupSql -Encoding utf8
}
$sqlPath = [System.IO.Path]::GetFullPath($BackupSql)
if (-not (Test-Path -LiteralPath $sqlPath -PathType Leaf)) { throw "Backup SQL file was not found: $sqlPath" }

if ($Manifest) {
  $manifestPath = [System.IO.Path]::GetFullPath($Manifest)
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Backup manifest was not found: $manifestPath" }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $sqlPath).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$manifest.sha256).ToLowerInvariant()) { throw "Backup SHA-256 does not match its manifest" }
}

$sql = Get-Content -Raw -LiteralPath $sqlPath
foreach ($required in @("CREATE TABLE", "users", "organizations", "licences")) {
  if ($sql -notmatch [regex]::Escape($required)) { throw "Backup does not contain the required marker: $required" }
}
Write-Host "Backup integrity markers and optional SHA-256 manifest verified: $sqlPath"
if ($temporaryFixture) { Remove-Item -LiteralPath $sqlPath -Force }

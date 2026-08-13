param(
  [string]$DbName = "veld-archive",
  [string]$PrimaryBucket = "veld-archive-backups",
  [string]$SecondaryBucket = "veld-archive-backups-dr",
  [string]$OutputDirectory = ".backups"
)

$ErrorActionPreference = "Stop"
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$dumpPath = Join-Path $resolvedOutput "$DbName-$runId.sql"
$manifestPath = Join-Path $resolvedOutput "$DbName-$runId.manifest.json"

Write-Host "Exporting remote D1 database $DbName"
& npx wrangler d1 export $DbName --remote --skip-confirmation --output $dumpPath
if ($LASTEXITCODE -ne 0) { throw "D1 export failed" }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $dumpPath).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  schemaVersion = 1
  database = $DbName
  exportedAt = $runId
  file = [System.IO.Path]::GetFileName($dumpPath)
  sha256 = $hash
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

$objectPrefix = "d1/$DbName/$runId"
foreach ($bucket in @($PrimaryBucket, $SecondaryBucket)) {
  Write-Host "Uploading D1 backup to $bucket"
  & npx wrangler r2 object put "$bucket/$objectPrefix/$($manifest.file)" --file $dumpPath
  if ($LASTEXITCODE -ne 0) { throw "D1 backup upload failed for $bucket" }
  & npx wrangler r2 object put "$bucket/$objectPrefix/$($manifest.file).manifest.json" --file $manifestPath
  if ($LASTEXITCODE -ne 0) { throw "D1 manifest upload failed for $bucket" }
}

Write-Host "D1 backup completed: $dumpPath"

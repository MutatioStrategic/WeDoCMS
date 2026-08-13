param(
  [string]$LibraryDir = (Join-Path (Get-Location) 'fixtures\test-photo-library')
)

$resolvedLibrary = (Resolve-Path -LiteralPath $LibraryDir -ErrorAction Stop).Path
$expectedRoot = (Resolve-Path -LiteralPath (Join-Path (Get-Location) 'fixtures\test-photo-library') -ErrorAction Stop).Path
if ($resolvedLibrary -ne $expectedRoot) {
  throw "Refusing to normalize outside the generated test-photo-library directory: $resolvedLibrary"
}

$manifestPath = Join-Path $resolvedLibrary 'manifest.json'
$manifestJson = Get-Content -LiteralPath $manifestPath -Raw
$parsedManifest = ConvertFrom-Json -InputObject $manifestJson
$manifest = @($parsedManifest | ForEach-Object { $_ })
if ($manifest.Count -ne 100) {
  throw "Refusing to normalize: expected exactly 100 manifest entries, found $($manifest.Count)"
}

foreach ($entry in $manifest) {
  $filePath = Join-Path $resolvedLibrary $entry.fileName
  if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
    throw "Refusing to normalize: missing $($entry.fileName)"
  }
  if (-not $entry.sourceSha1) {
    $entry | Add-Member -NotePropertyName sourceSha1 -NotePropertyValue ([string]$entry.sha1)
  }
  $entry.sha1 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA1).Hash.ToLowerInvariant()
  $entry.sizeBytes = (Get-Item -LiteralPath $filePath).Length
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "Normalized 100 manifest entries with sourceSha1 and downloaded sha1 values."

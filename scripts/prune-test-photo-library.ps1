param(
  [string]$LibraryDir = (Join-Path (Get-Location) 'fixtures\test-photo-library')
)

$resolvedLibrary = (Resolve-Path -LiteralPath $LibraryDir -ErrorAction Stop).Path
$expectedRoot = (Resolve-Path -LiteralPath (Join-Path (Get-Location) 'fixtures\test-photo-library') -ErrorAction Stop).Path
if ($resolvedLibrary -ne $expectedRoot) {
  throw "Refusing to prune outside the generated test-photo-library directory: $resolvedLibrary"
}

$manifestPath = Join-Path $resolvedLibrary 'manifest.json'
$manifestJson = Get-Content -LiteralPath $manifestPath -Raw
$parsedManifest = ConvertFrom-Json -InputObject $manifestJson
$manifest = @($parsedManifest | ForEach-Object { $_ })
if ($manifest.Count -ne 100) {
  throw "Refusing to prune: expected exactly 100 manifest entries, found $($manifest.Count)"
}
$expected = @{}
foreach ($entry in $manifest) {
  if ([string]::IsNullOrWhiteSpace($entry.fileName)) {
    throw 'Refusing to prune: manifest entry has no fileName'
  }
  $expected[$entry.fileName] = $true
}

$extras = @(Get-ChildItem -LiteralPath $resolvedLibrary -Filter 'photo-*' -File | Where-Object { -not $expected.ContainsKey($_.Name) })
foreach ($file in $extras) {
  Remove-Item -LiteralPath $file.FullName -Force
}

[pscustomobject]@{
  ManifestEntries = $manifest.Count
  RemovedStaleFiles = $extras.Count
  RemainingPhotoFiles = @(Get-ChildItem -LiteralPath $resolvedLibrary -Filter 'photo-*' -File).Count
}

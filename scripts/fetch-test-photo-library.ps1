param(
  [int]$Count = 100,
  [int]$ThumbWidth = 1200,
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

if ($Count -lt 1 -or $Count -gt 100) { throw "Count must be between 1 and 100." }
if ($ThumbWidth -lt 640 -or $ThumbWidth -gt 2000) { throw "ThumbWidth must be between 640 and 2000." }

$root = Split-Path -Parent $PSScriptRoot
$output = if ($OutputRoot) { [IO.Path]::GetFullPath($OutputRoot) } else { Join-Path $root "fixtures\test-photo-library" }
$manifestPath = Join-Path $output "manifest.json"
$api = "https://commons.wikimedia.org/w/api.php"
$userAgent = "StockvelTestLibrary/1.0 (contact: blewisorlando@gmail.com)"

# Five results per topic gives the model varied objects, settings, textures,
# vehicles, animals, food, architecture, and people without reusing one image
# for multiple semantic records.
$topics = @(
  "cat", "dog", "bird", "wildlife", "flower",
  "fruit", "food", "cup", "chair", "tool",
  "car", "bus", "bicycle", "train", "boat",
  "market", "building", "bridge", "mountain", "beach"
)

New-Item -ItemType Directory -Path $output -Force | Out-Null

function Get-ApiJson([hashtable]$Parameters) {
  $query = ($Parameters.GetEnumerator() | ForEach-Object {
    [Uri]::EscapeDataString([string]$_.Key) + "=" + [Uri]::EscapeDataString([string]$_.Value)
  }) -join "&"
  Invoke-RestMethod -Uri ($api + "?" + $query) -Headers @{ "User-Agent" = $userAgent }
}

function Get-Text([object]$Value) {
  if ($null -eq $Value) { return "" }
  return ([string]$Value.value -replace '<[^>]+>', '' -replace '\s+', ' ').Trim()
}

function Get-SafeFileStem([string]$Title) {
  $stem = $Title -replace '^File:', ''
  $stem = [IO.Path]::GetFileNameWithoutExtension($stem)
  $stem = $stem -replace '[^a-zA-Z0-9]+', '-'
  $stem = $stem.Trim('-').ToLowerInvariant()
  if (-not $stem) { $stem = 'commons-photo' }
  return $stem.Substring(0, [Math]::Min(90, $stem.Length))
}

$records = [System.Collections.Generic.List[object]]::new()
$seenSha = [System.Collections.Generic.HashSet[string]]::new()
$seenTitle = [System.Collections.Generic.HashSet[string]]::new()

foreach ($topic in $topics) {
  if ($records.Count -ge $Count) { break }
  $takenForTopic = 0
  $response = Get-ApiJson @{
    action = 'query'
    format = 'json'
    generator = 'search'
    gsrsearch = "$topic filetype:bitmap"
    gsrnamespace = '6'
    gsrlimit = '20'
    prop = 'imageinfo'
    iiprop = 'url|mime|size|sha1|extmetadata'
    iiurlwidth = [string]$ThumbWidth
    iiextmetadatalanguage = 'en'
    iiextmetadatafilter = 'Artist|Credit|ImageDescription|LicenseShortName|UsageTerms|DateTimeOriginal'
    origin = '*'
  }

  foreach ($page in @($response.query.pages.PSObject.Properties.Value)) {
    if ($records.Count -ge $Count -or $takenForTopic -ge 5) { break }
    $info = @($page.imageinfo)[0]
    if ($null -eq $info) { continue }
    if ($info.mime -notin @('image/jpeg', 'image/png', 'image/webp')) { continue }
    if (-not $info.thumburl -or -not $info.sha1) { continue }
    $license = Get-Text $info.extmetadata.LicenseShortName
    $usageTerms = Get-Text $info.extmetadata.UsageTerms
    if (-not $license -and -not $usageTerms) { continue }
    if ($seenSha.Contains([string]$info.sha1) -or $seenTitle.Contains([string]$page.title)) { continue }

    $number = $records.Count + 1
    $extension = switch ([string]$info.mime) {
      'image/png' { 'png' }
      'image/webp' { 'webp' }
      default { 'jpg' }
    }
    $stem = Get-SafeFileStem ([string]$page.title)
    $fileName = "photo-{0:D3}-{1}.{2}" -f $number, $stem, $extension
    $filePath = Join-Path $output $fileName

    $downloaded = $false
    for ($attempt = 1; $attempt -le 3 -and -not $downloaded; $attempt++) {
      try {
        Invoke-WebRequest -Uri ([string]$info.thumburl) -Headers @{ "User-Agent" = $userAgent } -OutFile $filePath
        $downloaded = (Get-Item -LiteralPath $filePath).Length -gt 1024
      } catch {
        if ($attempt -eq 3) { throw }
        $statusCode = 0
        if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        Start-Sleep -Seconds (if ($statusCode -eq 429) { 30 * $attempt } else { 2 * $attempt })
      }
    }
    if (-not $downloaded) { Remove-Item -LiteralPath $filePath -Force -ErrorAction SilentlyContinue; continue }

    $pageSlug = ([string]$page.title) -replace ' ', '_'
    $pageUrl = "https://commons.wikimedia.org/wiki/" + [Uri]::EscapeDataString($pageSlug)
    $record = [ordered]@{
      sequence = $number
      fileName = $fileName
      contentType = [string]$info.mime
      sizeBytes = (Get-Item -LiteralPath $filePath).Length
      sha1 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA1).Hash.ToLowerInvariant()
      sourceSha1 = [string]$info.sha1
      sourceTitle = [string]$page.title
      sourcePageUrl = $pageUrl
      sourceDownloadUrl = [string]$info.url
      downloadedUrl = [string]$info.thumburl
      sourceLicense = if ($license) { $license } else { $usageTerms }
      sourceUsageTerms = $usageTerms
      sourceAttribution = Get-Text $info.extmetadata.Artist
      sourceDescription = Get-Text $info.extmetadata.ImageDescription
      sourceCredit = Get-Text $info.extmetadata.Credit
      sourceDate = Get-Text $info.extmetadata.DateTimeOriginal
      searchTopic = $topic
    }
    $records.Add([PSCustomObject]$record)
    $takenForTopic++
    $seenSha.Add([string]$info.sha1) | Out-Null
    $seenTitle.Add([string]$page.title) | Out-Null
    Write-Host ("[{0}/{1}] {2} ({3})" -f $records.Count, $Count, $page.title, $license)
    Start-Sleep -Milliseconds 1000
  }
}

if ($records.Count -ne $Count) {
  throw "Only downloaded $($records.Count) unique licensed images; refusing to create an incomplete test set."
}

$records | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "Downloaded $($records.Count) real licensed test images to $output"
Write-Host "Manifest: $manifestPath"

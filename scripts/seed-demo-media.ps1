param(
  [switch]$Remote
)

$ErrorActionPreference = "Stop"

<##
Downloads the rights-aware South African demo set and places it in Wrangler D1/R2.

Local is the default. Pass -Remote only when deliberately promoting the fixtures to
the configured Cloudflare account. Use the source_url/source_download_url fields in
migrations 0011/0012 when promoting records to a configured staging or production environment.
#>

$root = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path $root "fixtures\demo-media"
$bucket = "veld-archive-media"
$storageFlag = if ($Remote) { "--remote" } else { "--local" }
$targetLabel = if ($Remote) { "remote Cloudflare" } else { "local Wrangler" }

$media = @(
  @{ file = "table-mountain-cape-town.jpg"; key = "originals/demo/table-mountain-cape-town.jpg"; preview = "previews/demo/table-mountain-cape-town.jpg"; type = "image/jpeg"; url = "https://upload.wikimedia.org/wikipedia/commons/1/14/Cape_Town_%28ZA%29%2C_Table_Mountain_--_2024_--_2794%2B96%2B98%2B2800%2B01.jpg" },
  @{ file = "garden-route-south-africa.jpg"; key = "originals/demo/garden-route-south-africa.jpg"; preview = "previews/demo/garden-route-south-africa.jpg"; type = "image/jpeg"; url = "https://upload.wikimedia.org/wikipedia/commons/7/7d/Garden_Route_South_Africa.jpg" },
  @{ file = "johannesburg-minibus-maboneng.jpg"; key = "originals/demo/johannesburg-minibus-maboneng.jpg"; preview = "previews/demo/johannesburg-minibus-maboneng.jpg"; type = "image/jpeg"; url = "https://upload.wikimedia.org/wikipedia/commons/5/54/2._Minibus_taxi_in_Maboneng%2C_Johannesburg%2C_South_Africa.jpg" },
  @{ file = "soweto-market-2011.jpg"; key = "originals/demo/soweto-market-2011.jpg"; preview = "previews/demo/soweto-market-2011.jpg"; type = "image/jpeg"; url = "https://upload.wikimedia.org/wikipedia/commons/8/84/Soweto_Market_2011.jpg" },
  @{ file = "simons-town-red-hill-cannon.webm"; key = "originals/demo/simons-town-red-hill-cannon.webm"; preview = "previews/demo/simons-town-red-hill-cannon.webm"; type = "video/webm"; url = "https://upload.wikimedia.org/wikipedia/commons/3/34/Aerial_view_of_the_Red_Hill_Cannon_in_Simons_Town%2C_Cape_Town%2C_South_Africa.webm" },
  @{ file = "cape-town-coastline.mp4"; key = "originals/demo/cape-town-coastline.mp4"; preview = "previews/demo/cape-town-coastline.mp4"; type = "video/mp4"; url = "https://cdn.pixabay.com/video/2026/04/14/346332_medium.mp4" }
)

New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null

foreach ($item in $media) {
  $path = Join-Path $fixtureRoot $item.file
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Host "Downloading $($item.file)..."
    curl.exe -L --fail --retry 4 --retry-delay 2 -A "VeldArchiveDemoSeeder/1.0 (local development)" -o $path $item.url
    if ($LASTEXITCODE -ne 0) { throw "Download failed for $($item.file)." }
  } else {
    Write-Host "Keeping existing $($item.file)"
  }
}

Write-Host "Applying $targetLabel D1 migrations..."
npx.cmd wrangler d1 migrations apply veld-archive $storageFlag
if ($LASTEXITCODE -ne 0) { throw "D1 migration failed." }

foreach ($item in $media) {
  $path = Join-Path $fixtureRoot $item.file
  Write-Host "Uploading $($item.key) to $targetLabel R2..."
  npx.cmd wrangler r2 object put "$bucket/$($item.key)" $storageFlag --file $path --content-type $item.type --force
  if ($LASTEXITCODE -ne 0) { throw "Original R2 upload failed for $($item.file)." }

  Write-Host "Uploading $($item.preview) to $targetLabel R2..."
  npx.cmd wrangler r2 object put "$bucket/$($item.preview)" $storageFlag --file $path --content-type $item.type --force
  if ($LASTEXITCODE -ne 0) { throw "Preview R2 upload failed for $($item.file)." }
}

Write-Host "Verifying seeded D1 records in $targetLabel..."
$query = "SELECT id, kind, status, title, source_license, source_attribution FROM assets WHERE demo_seed = 1 ORDER BY id"
npx.cmd wrangler d1 execute veld-archive $storageFlag --command $query
if ($LASTEXITCODE -ne 0) { throw "D1 verification failed." }

Write-Host "Demo media seed complete. Files are in $fixtureRoot and $targetLabel R2 bucket $bucket."

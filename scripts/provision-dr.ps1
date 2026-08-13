param(
  [string]$PrimaryMediaBucket = "veld-archive-media",
  [string]$SecondaryMediaBucket = "veld-archive-media-dr",
  [string]$PrimaryBackupBucket = "veld-archive-backups",
  [string]$SecondaryBackupBucket = "veld-archive-backups-dr",
  [string]$QueueName = "veld-archive-r2-events"
)

$ErrorActionPreference = "Stop"

Write-Host "Create the primary media bucket if it does not already exist."
& npx wrangler r2 bucket create $PrimaryMediaBucket --location wnam
if ($LASTEXITCODE -ne 0) { Write-Warning "Primary media bucket may already exist; verify with 'wrangler r2 bucket list'." }

Write-Host "Creating geographically separate media and backup buckets in Western Europe."
& npx wrangler r2 bucket create $SecondaryMediaBucket --location weur
if ($LASTEXITCODE -ne 0) { throw "Could not create $SecondaryMediaBucket" }
& npx wrangler r2 bucket create $PrimaryBackupBucket --location wnam
if ($LASTEXITCODE -ne 0) { throw "Could not create $PrimaryBackupBucket" }
& npx wrangler r2 bucket create $SecondaryBackupBucket --location weur
if ($LASTEXITCODE -ne 0) { throw "Could not create $SecondaryBackupBucket" }

Write-Host "Creating the R2 event queue."
& npx wrangler queues create $QueueName
if ($LASTEXITCODE -ne 0) { Write-Warning "Queue may already exist; verify with 'wrangler queues list'." }

Write-Host "Registering object-create notifications for originals/."
& npx wrangler r2 bucket notification create $PrimaryMediaBucket --event-type object-create --queue $QueueName --prefix "originals/"
if ($LASTEXITCODE -ne 0) { throw "Could not register the R2 event notification" }

Write-Host "DR resources are ready. Apply migrations and deploy the Worker next."

$ErrorActionPreference = "Stop"
$port = if ($env:SMOKE_PORT) { [int]$env:SMOKE_PORT } else { 8787 }
if ($port -lt 1024 -or $port -gt 65535) { throw "SMOKE_PORT must be between 1024 and 65535: $port" }
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "SMOKE_PORT $port is already in use by process $($listener[0].OwningProcess). Choose another port with SMOKE_PORT." }
$baseUrl = "http://127.0.0.1:$port"
$logPath = Join-Path (Get-Location) "worker-smoke-$port.log"
$errPath = Join-Path (Get-Location) "worker-smoke-$port.err.log"
$smokeSecret = "ci-session-secret-that-is-long-enough-for-tests"
$workerCommand = "npx wrangler dev --local --port $port --var SESSION_SECRET:$smokeSecret --var PAYMENT_WEBHOOK_SECRET:ci-payment-webhook-secret-that-is-long-enough"
$worker = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-Command", $workerCommand -WorkingDirectory (Get-Location) -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errPath -PassThru
function Stop-Tree([int]$processId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $processId"
  foreach ($child in $children) { Stop-Tree $child.ProcessId }
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri "$baseUrl/api/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "Worker did not become ready. See $logPath and $errPath" }
  $env:E2E_BASE_URL = $baseUrl
  node scripts/authenticated-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw "Authenticated smoke failed with exit code $LASTEXITCODE. See $logPath and $errPath" }
  node scripts/penetration-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw "Penetration smoke failed with exit code $LASTEXITCODE. See $logPath and $errPath" }
  node scripts/payment-reconciliation-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw "Payment reconciliation smoke failed with exit code $LASTEXITCODE. See $logPath and $errPath" }
  $env:FUZZ_BASE_URL = $baseUrl
  node scripts/fuzz-http.mjs
  if ($LASTEXITCODE -ne 0) { throw "HTTP fuzz smoke failed with exit code $LASTEXITCODE. See $logPath and $errPath" }
} finally {
  if ($worker) { Stop-Tree $worker.Id }
}

$ErrorActionPreference = "Stop"
$logPath = Join-Path (Get-Location) "worker-smoke.log"
$errPath = Join-Path (Get-Location) "worker-smoke.err.log"
$smokeSecret = "ci-session-secret-that-is-long-enough-for-tests"
$workerCommand = "npx wrangler dev --local --port 8787 --var SESSION_SECRET:$smokeSecret --var PAYMENT_WEBHOOK_SECRET:ci-payment-webhook-secret-that-is-long-enough"
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
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "Worker did not become ready. See $logPath and $errPath" }
  $env:E2E_BASE_URL = "http://127.0.0.1:8787"
  node scripts/authenticated-smoke.mjs
  node scripts/penetration-smoke.mjs
  node scripts/payment-reconciliation-smoke.mjs
} finally {
  if ($worker) { Stop-Tree $worker.Id }
}

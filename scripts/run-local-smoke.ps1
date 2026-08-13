$ErrorActionPreference = "Stop"
$smokePort = if ($env:SMOKE_PORT) { $env:SMOKE_PORT } else { "8788" }
$logPath = Join-Path (Get-Location) "worker-smoke.log"
$errPath = Join-Path (Get-Location) "worker-smoke.err.log"
$smokeSecret = "ci-session-secret-that-is-long-enough-for-tests"
$workerCommand = "npx.cmd wrangler dev --local --port $smokePort --var SESSION_SECRET:$smokeSecret --var PAYMENT_WEBHOOK_SECRET:ci-payment-webhook-secret-that-is-long-enough --var STREAM_WEBHOOK_SECRET:ci-stream-webhook-secret-that-is-long-enough"
$worker = Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/c", $workerCommand -WorkingDirectory (Get-Location) -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errPath -PassThru
function Stop-Tree([int]$processId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $processId"
  foreach ($child in $children) { Stop-Tree $child.ProcessId }
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$smokePort/api/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "Worker did not become ready. See $logPath and $errPath" }
  $env:E2E_BASE_URL = "http://127.0.0.1:$smokePort"
  node scripts/authenticated-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw "Authenticated smoke test failed with exit code $LASTEXITCODE" }
  node scripts/penetration-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw "Penetration smoke test failed with exit code $LASTEXITCODE" }
  node scripts/payment-reconciliation-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw "Payment reconciliation smoke test failed with exit code $LASTEXITCODE" }
  $env:FUZZ_BASE_URL = "http://127.0.0.1:$smokePort"
  node scripts/fuzz-http.mjs
  if ($LASTEXITCODE -ne 0) { throw "HTTP fuzz test failed with exit code $LASTEXITCODE" }
  node scripts/blast-radius-contract.mjs
  if ($LASTEXITCODE -ne 0) { throw "Blast-radius contract test failed with exit code $LASTEXITCODE" }
  if ($env:RUN_CONTRACT_PROVIDER -eq "true") {
    $env:CONTRACT_PROVIDER_URL = "http://127.0.0.1:$smokePort"
    node scripts/contracts-provider.mjs
    if ($LASTEXITCODE -ne 0) { throw "Pact provider verification failed with exit code $LASTEXITCODE" }
  }
} finally {
  if ($worker) { Stop-Tree $worker.Id }
}

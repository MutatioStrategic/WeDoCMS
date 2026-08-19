$env:VISION_PROXY_TOKEN = [Environment]::GetEnvironmentVariable('VISION_PROXY_TOKEN', 'User')
if ([string]::IsNullOrWhiteSpace($env:VISION_PROXY_TOKEN)) { throw 'VISION_PROXY_TOKEN is not configured' }
$env:VISION_PROXY_PORT = '11437'
$env:OLLAMA_URL = 'http://127.0.0.1:11436/api/generate'
node (Join-Path $PSScriptRoot 'local-vision-proxy.mjs')

$repo = Split-Path -Parent $PSScriptRoot
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $repo 'scripts\start-local-qwen3.ps1') -WindowStyle Hidden
Start-Sleep -Seconds 5
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $repo 'scripts\start-local-vision-proxy.ps1') -WindowStyle Hidden
Write-Output 'Started Qwen3-VL on 127.0.0.1:11436 and the authenticated vision proxy on 127.0.0.1:11437.'

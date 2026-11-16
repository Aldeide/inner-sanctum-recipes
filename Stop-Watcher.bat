@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$pidFile = Join-Path $PWD 'logs\watcher.pid'; if (-not (Test-Path $pidFile)) { Write-Host '[INFO] No watcher PID file found at logs\watcher.pid. Watcher is not running.' -ForegroundColor Yellow; exit 0 }; $pidVal = (Get-Content $pidFile -Raw).Trim(); if ($pidVal -and (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) { Stop-Process -Id $pidVal -Force; Write-Host ('[SUCCESS] Terminated watcher process PID ' + $pidVal) -ForegroundColor Green } else { Write-Host ('[INFO] Process PID ' + $pidVal + ' was not running.') -ForegroundColor Yellow }; Remove-Item $pidFile -Force -ErrorAction SilentlyContinue; Write-Host '[SUCCESS] Watcher stopped and logs\watcher.pid removed.' -ForegroundColor Green"

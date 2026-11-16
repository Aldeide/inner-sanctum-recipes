@echo off
setlocal
cd /d "%~dp0"

echo [Watcher] Launching hidden background recipe watcher...
wscript.exe //B //NoLogo "%~dp0launch-watcher-hidden.vbs"
powershell -NoProfile -Command "Start-Sleep -Seconds 2"

if exist "logs\watcher.pid" (
    powershell -NoProfile -Command "$p = (Get-Content 'logs\watcher.pid' -Raw).Trim(); if ($p -and (Get-Process -Id $p -ErrorAction SilentlyContinue)) { Write-Host ('[SUCCESS] Watcher is actively running in background (PID: ' + $p + ').') -ForegroundColor Green } else { Write-Host ('[ERROR] PID file exists but process ' + $p + ' is not running.') -ForegroundColor Red }"
) else (
    echo [ERROR] logs\watcher.pid was not created. Check logs\watcher.log for details.
)

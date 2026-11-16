@echo off
setlocal
cd /d "%~dp0"

echo [Watcher] Launching hidden background recipe watcher...
wscript.exe //B //NoLogo "%~dp0launch-watcher-hidden.vbs"
timeout /t 2 /nobreak >nul

if exist "logs\watcher.pid" (
    set /p WATCHER_PID=<"logs\watcher.pid"
    powershell -NoProfile -Command "if (Get-Process -Id %WATCHER_PID% -ErrorAction SilentlyContinue) { Write-Host ('[SUCCESS] Watcher is actively running in background (PID: ' + %WATCHER_PID% + ').') -ForegroundColor Green } else { Write-Host ('[ERROR] PID file exists but process ' + %WATCHER_PID% + ' is not running.') -ForegroundColor Red }"
) else (
    echo [ERROR] logs\watcher.pid was not created. Check logs\watcher.log for details.
)

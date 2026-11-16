@echo off
setlocal
cd /d "%~dp0"

if not exist "logs\watcher.pid" (
    echo [INFO] No watcher PID file found at logs\watcher.pid. Watcher is not running.
    exit /b 0
)

set /p WATCHER_PID=<"logs\watcher.pid"
echo [Watcher] Stopping GuildRecipeBook watcher (PID: %WATCHER_PID%)...

powershell -NoProfile -Command "$pidVal = '%WATCHER_PID%'.Trim(); if ($pidVal -and (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) { Stop-Process -Id $pidVal -Force; Write-Host ('[SUCCESS] Terminated watcher process PID ' + $pidVal) -ForegroundColor Green } else { Write-Host ('[INFO] Process PID ' + $pidVal + ' was not running.') -ForegroundColor Yellow }"

if exist "logs\watcher.pid" (
    del /f /q "logs\watcher.pid" >nul 2>&1
)
echo [SUCCESS] Watcher stopped and logs\watcher.pid removed.

@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
  $rootDir = $PWD;
  $pidFile = Join-Path $rootDir 'logs\watcher.pid';
  $logFile = Join-Path $rootDir 'logs\watcher.log';
  $startupFile = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\InnerSanctumRecipeWatcher.vbs';

  Write-Host '============================================================' -ForegroundColor DarkGray;
  Write-Host ' GuildRecipeBook Background File Watcher Status' -ForegroundColor Cyan;
  Write-Host '============================================================' -ForegroundColor DarkGray;

  Write-Host '1. Watcher Process:' -ForegroundColor Yellow;
  if (Test-Path $pidFile) {
    $pidVal = (Get-Content $pidFile -Raw).Trim();
    $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue;
    if ($proc) {
      $winHandle = $proc.MainWindowHandle;
      $windowless = if ($winHandle -eq 0) { 'Hidden (no window)' } else { 'Window visible' };
      Write-Host ('   [RUNNING] PID: ' + $pidVal + ' | Memory: ' + [math]::Round($proc.WorkingSet64/1MB,2) + 'MB | Window: ' + $windowless) -ForegroundColor Green;
    } else {
      Write-Host ('   [STOPPED] Stale PID file exists (PID: ' + $pidVal + ' not running).') -ForegroundColor Red;
    }
  } else {
    Write-Host '   [STOPPED] Watcher is not running (logs\watcher.pid does not exist).' -ForegroundColor Gray;
  }

  Write-Host '';
  Write-Host '2. Windows Startup Registration:' -ForegroundColor Yellow;
  if (Test-Path $startupFile) {
    Write-Host ('   [REGISTERED] ' + $startupFile) -ForegroundColor Green;
  } else {
    Write-Host ('   [NOT FOUND] ' + $startupFile) -ForegroundColor Yellow;
  }

  Write-Host '';
  Write-Host '3. Watcher Log Excerpt (last 20 lines):' -ForegroundColor Yellow;
  if (Test-Path $logFile) {
    Get-Content $logFile -Tail 20 | ForEach-Object { Write-Host ('   ' + $_) };
  } else {
    Write-Host '   (No log file found at logs\watcher.log)' -ForegroundColor Gray;
  }

  Write-Host '============================================================' -ForegroundColor DarkGray;
}"

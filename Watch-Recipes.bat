@echo off
setlocal
cd /d "%~dp0"
echo ===================================================
echo   Guild Recipe Book Web - Live Watch Mode
echo ===================================================
echo.
echo Watching your World of Warcraft SavedVariables folder.
echo Any time you type /reload or log out in WoW, your recipe
echo book will automatically re-export with latest data!
echo.
echo Leave this window open while playing WoW.
echo Press Ctrl+C at any time to stop.
echo.
node "%~dp0export.mjs" --watch
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Watch process stopped unexpectedly.
    pause
)

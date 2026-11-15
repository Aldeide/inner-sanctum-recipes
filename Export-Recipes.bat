@echo off
setlocal
cd /d "%~dp0"
echo ===================================================
echo   Guild Recipe Book Web - Exporter
echo ===================================================
echo.
echo Running recipe export and WarcraftDB enrichment...
node "%~dp0export.mjs"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Export failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Export successful! Opening recipe book in your browser...
if exist "%~dp0dist\index.html" (
    start "" "%~dp0dist\index.html"
) else (
    echo [NOTE] dist\recipes.json is ready. dist\index.html will be generated once template is present.
)
timeout /t 3 >nul

@echo off
setlocal
cd /d "%~dp0\.."

if "%~1"=="" (
  echo Error: Store login ID required.
  echo Usage: start-store-worker.cmd store-1
  pause
  exit /b 1
)

echo Starting ListFlow Worker for store: %~1
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker -- --store %~1 2>&1 | Tee-Object -FilePath 'logs\worker-%~1.log' -Append"

echo.
echo ListFlow Worker stopped for store: %~1
pause

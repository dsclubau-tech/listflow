@echo off
setlocal
cd /d "%~dp0\.."
title Update ListFlow Workers

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-listflow-workers.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo Update failed. No local changes were discarded.
  echo Check logs\update-worker.log or use Repair ListFlow Workers.
)
echo.
pause
exit /b %EXIT_CODE%

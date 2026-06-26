@echo off
setlocal
cd /d "%~dp0"
title Setup ListFlow Worker

if not exist logs mkdir logs

echo Setting up ListFlow Worker...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-listflow-worker.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
if "%EXIT_CODE%"=="0" (
  echo Setup complete. You can now use the "Start ListFlow Worker" desktop shortcut.
) else (
  echo Setup failed. Check logs\setup-worker.log for details.
)
echo.
pause
exit /b %EXIT_CODE%

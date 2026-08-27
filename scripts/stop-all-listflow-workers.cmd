@echo off
setlocal
cd /d "%~dp0\.."
title Stop All ListFlow Workers

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-listflow-workers.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
pause
exit /b %EXIT_CODE%

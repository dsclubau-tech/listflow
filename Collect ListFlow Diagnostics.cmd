@echo off
setlocal
cd /d "%~dp0"
title Collect ListFlow Diagnostics
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\collect-worker-diagnostics.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
pause
exit /b %EXIT_CODE%

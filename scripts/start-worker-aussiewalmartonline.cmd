@echo off
setlocal
set "LISTFLOW_WORKER_DATABASE_PROFILE=deployed"
cd /d "%~dp0\.."
title ListFlow Worker - Aussie Walmart

if not exist logs mkdir logs

echo Starting ListFlow Worker for Aussie Walmart (aussiewalmartonline)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker -- --store aussiewalmartonline 2>&1 | Tee-Object -FilePath 'logs\worker-aussiewalmartonline.log' -Append"

echo.
echo ListFlow Worker stopped for Aussie Walmart.
pause

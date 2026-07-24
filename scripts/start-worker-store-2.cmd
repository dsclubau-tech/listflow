@echo off
setlocal
cd /d "%~dp0\.."
title ListFlow Worker - Store 2

if not exist logs mkdir logs

echo Starting ListFlow Worker for Store 2 (store-2)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker -- --store store-2 2>&1 | Tee-Object -FilePath 'logs\worker-store-2.log' -Append"

echo.
echo ListFlow Worker stopped for Store 2.
pause

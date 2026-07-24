@echo off
setlocal
cd /d "%~dp0\.."
title ListFlow Worker - Store 3

if not exist logs mkdir logs

echo Starting ListFlow Worker for Store 3 (store-3)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker -- --store store-3 2>&1 | Tee-Object -FilePath 'logs\worker-store-3.log' -Append"

echo.
echo ListFlow Worker stopped for Store 3.
pause

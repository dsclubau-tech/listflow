@echo off
setlocal
cd /d "%~dp0\.."
title ListFlow Worker - RK Ecommerce Store

if not exist logs mkdir logs

echo Starting ListFlow Worker for RK Ecommerce Store (store-1)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker -- --store store-1 2>&1 | Tee-Object -FilePath 'logs\worker-store-1.log' -Append"

echo.
echo ListFlow Worker stopped for RK Ecommerce Store.
pause

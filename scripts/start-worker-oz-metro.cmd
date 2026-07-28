@echo off
setlocal
cd /d "%~dp0\.."
title ListFlow Worker - Oz Metro

if not exist logs mkdir logs

echo Starting ListFlow Worker for Oz Metro (oz-metro)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker -- --store oz-metro 2>&1 | Tee-Object -FilePath 'logs\worker-oz-metro.log' -Append"

echo.
echo ListFlow Worker stopped for Oz Metro.
pause

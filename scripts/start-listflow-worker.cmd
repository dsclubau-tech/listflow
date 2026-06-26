@echo off
setlocal
cd /d "%~dp0\.."
title ListFlow Worker

if not exist logs mkdir logs

echo ListFlow Worker online
echo Waiting for jobs...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker 2>&1 | Tee-Object -FilePath 'logs\worker.log' -Append"

echo.
echo ListFlow Worker stopped. You can close this window.
pause

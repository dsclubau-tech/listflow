@echo off
setlocal
cd /d "%~dp0\.."
title ListFlow - Six Local Workers

if not exist logs mkdir logs

echo Starting two local workers for each configured ListFlow store...
echo Keep this controller window open. Use the Stop All shortcut for a graceful shutdown.
echo.

npm.cmd run workers:local
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo The local worker supervisor stopped with exit code %EXIT_CODE%.
  echo Check the logs folder, then use Repair ListFlow Workers if needed.
) else (
  echo All local ListFlow workers have stopped.
)
echo.
pause
exit /b %EXIT_CODE%

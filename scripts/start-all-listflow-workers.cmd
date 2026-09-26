@echo off
setlocal
cd /d "%~dp0\.."
title ListFlow - Six Local Workers

if not exist logs mkdir logs

if not exist "node_modules\.bin\tsx.cmd" (
  echo Worker dependencies are missing: the local tsx runtime was not found.
  echo Use Update ListFlow Workers or Repair ListFlow Workers to restore them.
  echo If your updater also fails with a missing tsx error, stop all workers first,
  echo then open a terminal in this folder and run: npm.cmd ci --include=dev
  echo.
  pause
  exit /b 1
)

echo Starting two local workers for each configured ListFlow store...
echo Keep this controller window open. Use the Stop All shortcut for a graceful shutdown.
echo.

call npm.cmd run workers:local
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo The local worker supervisor stopped with exit code %EXIT_CODE%.
  echo If it says the supervisor is already running, the workers are running in the background.
  echo Check the logs folder, then use Repair ListFlow Workers if needed.
) else (
  echo All local ListFlow workers have stopped.
)
echo.
pause
exit /b %EXIT_CODE%

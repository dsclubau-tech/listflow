@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker-package\Manage.ps1" -Action Start
set EXIT_CODE=%ERRORLEVEL%
pause
exit /b %EXIT_CODE%

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
$desktop = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$launchersDir = Join-Path $repoRoot "logs\launchers"
New-Item -ItemType Directory -Force -Path $launchersDir | Out-Null

Write-Host "Scanning active ListFlow stores..."

$nodeCmd = Get-Command "npx.cmd" -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    $nodeCmd = Get-Command "npx" -ErrorAction Stop
}

$getStoresScript = Join-Path $repoRoot "scripts\get-active-stores.ts"
$previousProfile = $env:LISTFLOW_WORKER_DATABASE_PROFILE
$env:LISTFLOW_WORKER_DATABASE_PROFILE = "deployed"
try {
    $jsonOutput = & $nodeCmd.Path tsx $getStoresScript --local-workers
} finally {
    $env:LISTFLOW_WORKER_DATABASE_PROFILE = $previousProfile
}

if ($LASTEXITCODE -ne 0) {
    throw "Could not load active stores from the deployed database."
}

$stores = $jsonOutput | ConvertFrom-Json

if (-not $stores -or $stores.Count -eq 0) {
    Write-Warning "No active stores found."
    exit 0
}

Write-Host "Found $($stores.Count) active store(s):"

$wshShell = New-Object -ComObject WScript.Shell

foreach ($store in $stores) {
    $loginId = if ($store.loginId) { $store.loginId } else { $store.id }
    $sanitizedLoginId = $loginId.ToLower() -replace '[^a-z0-9-]', '-'
    $storeName = $store.name

    $legacyShortcutPath = Join-Path $desktop "Start Worker - $storeName.lnk"
    Remove-Item -LiteralPath $legacyShortcutPath -Force -ErrorAction SilentlyContinue

    foreach ($slot in @("a", "b")) {
      $slotUpper = $slot.ToUpperInvariant()
      $workerId = "local-$sanitizedLoginId-$slot"
      $workerName = "$storeName Local Worker $slotUpper"
      $cmdFileName = "start-worker-$sanitizedLoginId-$slot.cmd"
      $cmdFilePath = Join-Path $launchersDir $cmdFileName

      $cmdContent = @"
@echo off
setlocal
set "LISTFLOW_WORKER_DATABASE_PROFILE=deployed"
set "LISTFLOW_WORKER_ROLE=store-specific"
set "LISTFLOW_WORKER_ID=$workerId"
set "LISTFLOW_WORKER_NAME=$workerName"
set "LISTFLOW_WORKER_STORE_LOGIN_ID=$loginId"
set "LISTFLOW_AMAZON_RETRY_TARGET=peer"
set "LISTFLOW_USE_LOCAL_PLAYWRIGHT=true"
cd /d "%~dp0\.."
cd /d "$repoRoot"
set "LISTFLOW_WORKER_STOP_FILE=%CD%\logs\$workerId.stop"
title ListFlow Worker - $workerName

if not exist logs mkdir logs
if exist "%LISTFLOW_WORKER_STOP_FILE%" del /q "%LISTFLOW_WORKER_STOP_FILE%"

echo Starting $workerName ($loginId)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker -- --store $loginId 2^>^&1 ^| Tee-Object -FilePath 'logs\worker-$sanitizedLoginId-$slot.log' -Append"

echo.
echo $workerName stopped.
pause
"@

      Set-Content -Path $cmdFilePath -Value $cmdContent -Encoding ASCII
      Write-Host "  [+] Created diagnostic launcher: $cmdFileName"

      $shortcutName = "Start Worker $slotUpper - $storeName.lnk"
      $shortcutPath = Join-Path $desktop $shortcutName

      $shortcut = $wshShell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = $cmdFilePath
      $shortcut.WorkingDirectory = $repoRoot
      $shortcut.IconLocation = "cmd.exe,0"
      $shortcut.Description = "Start $workerName for diagnostics"
      $shortcut.Save()

      Write-Host "  [+] Created Desktop Shortcut: '$shortcutName'"
    }
}

Write-Host ""
Write-Host "Two diagnostic worker shortcuts per store were created on your Desktop."

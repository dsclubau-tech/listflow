$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
$desktop = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)

Write-Host "Scanning active ListFlow stores..."

$nodeCmd = Get-Command "npx.cmd" -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    $nodeCmd = Get-Command "npx" -ErrorAction Stop
}

$getStoresScript = Join-Path $repoRoot "scripts\get-active-stores.ts"
$jsonOutput = & $nodeCmd.Path tsx $getStoresScript

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

    $cmdFileName = "start-worker-$sanitizedLoginId.cmd"
    $cmdFilePath = Join-Path $repoRoot "scripts\$cmdFileName"

    $cmdContent = @"
@echo off
setlocal
set "LISTFLOW_WORKER_DATABASE_PROFILE=deployed"
cd /d "%~dp0\.."
title ListFlow Worker - $storeName

if not exist logs mkdir logs

echo Starting ListFlow Worker for $storeName ($loginId)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "npm.cmd run worker -- --store $loginId 2>&1 | Tee-Object -FilePath 'logs\worker-$sanitizedLoginId.log' -Append"

echo.
echo ListFlow Worker stopped for $storeName.
pause
"@

    Set-Content -Path $cmdFilePath -Value $cmdContent -Encoding ASCII
    Write-Host "  [+] Created script: $cmdFileName"

    $shortcutName = "Start Worker - $storeName.lnk"
    $shortcutPath = Join-Path $desktop $shortcutName

    $shortcut = $wshShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $cmdFilePath
    $shortcut.WorkingDirectory = $repoRoot
    $shortcut.IconLocation = "cmd.exe,0"
    $shortcut.Description = "Start dedicated ListFlow worker for $storeName"
    $shortcut.Save()

    Write-Host "  [+] Created Desktop Shortcut: '$shortcutName'"
}

Write-Host ""
Write-Host "Dedicated per-store worker shortcuts created successfully on your Desktop!"

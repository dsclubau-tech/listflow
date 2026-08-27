param(
  [switch]$CreateRepairShortcut
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$startPath = Join-Path $repoRoot "scripts\start-all-listflow-workers.cmd"
$stopPath = Join-Path $repoRoot "scripts\stop-all-listflow-workers.cmd"
$updatePath = Join-Path $repoRoot "scripts\update-listflow-workers.cmd"
$setupPath = Join-Path $repoRoot "Setup ListFlow Worker.cmd"
$desktop = [Environment]::GetFolderPath("Desktop")
$startShortcutPath = Join-Path $desktop "Start All 6 ListFlow Workers.lnk"
$stopShortcutPath = Join-Path $desktop "Stop All ListFlow Workers.lnk"
$updateShortcutPath = Join-Path $desktop "Update ListFlow Workers.lnk"
$repairShortcutPath = Join-Path $desktop "Repair ListFlow Workers.lnk"

foreach ($requiredPath in @($startPath, $stopPath, $updatePath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Worker control script was not found at $requiredPath"
  }
}

$shell = New-Object -ComObject WScript.Shell

function New-ListFlowShortcut($shortcutPath, $targetPath, $description) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.WindowStyle = 1
  $shortcut.Description = $description
  $shortcut.Save()
  Write-Host "Created desktop shortcut: $shortcutPath"
}

New-ListFlowShortcut $startShortcutPath $startPath "Start two local workers for each ListFlow store"
New-ListFlowShortcut $stopShortcutPath $stopPath "Gracefully stop all local ListFlow workers"
New-ListFlowShortcut $updateShortcutPath $updatePath "Update stable ListFlow worker code and restart all workers"

$legacyShortcutPath = Join-Path $desktop "Start ListFlow Worker.lnk"
Remove-Item -LiteralPath $legacyShortcutPath -Force -ErrorAction SilentlyContinue
$legacyRepairShortcutPath = Join-Path $desktop "Repair ListFlow Worker.lnk"
Remove-Item -LiteralPath $legacyRepairShortcutPath -Force -ErrorAction SilentlyContinue

if ($CreateRepairShortcut) {
  if (-not (Test-Path $setupPath)) {
    throw "Worker setup script was not found at $setupPath"
  }

  New-ListFlowShortcut $repairShortcutPath $setupPath "Repair or reinstall the ListFlow worker setup"
}

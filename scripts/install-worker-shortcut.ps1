param(
  [switch]$CreateRepairShortcut
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$targetPath = Join-Path $repoRoot "scripts\start-listflow-worker.cmd"
$setupPath = Join-Path $repoRoot "Setup ListFlow Worker.cmd"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Start ListFlow Worker.lnk"
$repairShortcutPath = Join-Path $desktop "Repair ListFlow Worker.lnk"

if (-not (Test-Path $targetPath)) {
  throw "Worker start script was not found at $targetPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 1
$shortcut.Description = "Start the manual ListFlow worker for long jobs"
$shortcut.Save()

Write-Host "Created desktop shortcut:"
Write-Host $shortcutPath

if ($CreateRepairShortcut) {
  if (-not (Test-Path $setupPath)) {
    throw "Worker setup script was not found at $setupPath"
  }

  $repairShortcut = $shell.CreateShortcut($repairShortcutPath)
  $repairShortcut.TargetPath = $setupPath
  $repairShortcut.WorkingDirectory = $repoRoot
  $repairShortcut.WindowStyle = 1
  $repairShortcut.Description = "Repair or reinstall the ListFlow worker setup"
  $repairShortcut.Save()

  Write-Host "Created repair shortcut:"
  Write-Host $repairShortcutPath
}

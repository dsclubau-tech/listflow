$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$targetPath = Join-Path $repoRoot "scripts\start-listflow-worker.cmd"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Start ListFlow Worker.lnk"

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

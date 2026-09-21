$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$logsDir = Join-Path $repoRoot "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$logPath = Join-Path $logsDir "update-worker.log"
$transcriptStarted = $false

function Invoke-CheckedCommand($label, $filePath, $arguments) {
  Write-Host ""
  Write-Host "==> $label" -ForegroundColor Cyan
  & $filePath @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$label failed with exit code $LASTEXITCODE."
  }
}

function Get-PlaywrightVersion {
  $version = & node.exe -e "try { process.stdout.write(require('playwright/package.json').version) } catch {}"
  if ($LASTEXITCODE -ne 0) { return "" }
  return ($version | Out-String).Trim()
}

try {
  Start-Transcript -Path $logPath -Append | Out-Null
  $transcriptStarted = $true

  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw "Git was not found. Install Git for Windows, then use Repair ListFlow Workers."
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm was not found. Install Node.js LTS, then use Repair ListFlow Workers."
  }

  $branch = (& git.exe branch --show-current | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne "master") {
    throw "Updates are allowed only from the stable master branch. Current branch: $branch"
  }

  $dirty = (& git.exe status --porcelain --untracked-files=all | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the Git working tree." }
  if ($dirty) {
    throw "The Git working tree has local changes. The updater will not overwrite them."
  }

  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot ".env"))) {
    throw ".env is missing. Run Repair ListFlow Workers before updating."
  }

  Invoke-CheckedCommand "Fetching stable ListFlow updates" "git.exe" @("fetch", "origin", "master")
  & git.exe merge-base --is-ancestor HEAD origin/master
  if ($LASTEXITCODE -ne 0) {
    throw "Local master cannot fast-forward to origin/master. No files were changed."
  }

  $oldCommit = (& git.exe rev-parse HEAD | Out-String).Trim()
  $newCommit = (& git.exe rev-parse origin/master | Out-String).Trim()
  if ($oldCommit -eq $newCommit) {
    Write-Host "ListFlow is already up to date. Workers were left unchanged."
    exit 0
  }

  Invoke-CheckedCommand "Validating the current six-worker configuration" "npm.cmd" @("run", "workers:local:check")
  $oldPlaywrightVersion = Get-PlaywrightVersion
  Invoke-CheckedCommand "Stopping local workers gracefully" "powershell.exe" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    (Join-Path $PSScriptRoot "stop-listflow-workers.ps1")
  )
  Invoke-CheckedCommand "Fast-forwarding stable master" "git.exe" @("merge", "--ff-only", "origin/master")
  Invoke-CheckedCommand "Installing exact dependencies" "npm.cmd" @("ci")
  Invoke-CheckedCommand "Generating Prisma client" "npm.cmd" @("exec", "prisma", "generate")

  $newPlaywrightVersion = Get-PlaywrightVersion
  if (-not $oldPlaywrightVersion -or $oldPlaywrightVersion -ne $newPlaywrightVersion) {
    Invoke-CheckedCommand "Installing the matching Chromium browser" "npm.cmd" @("run", "browser:install")
  }

  Invoke-CheckedCommand "Checking the six-worker configuration" "npm.cmd" @("run", "workers:local:check")

  Write-Host ""
  Write-Host "==> Starting all six local workers" -ForegroundColor Cyan
  Start-Process -FilePath (Join-Path $PSScriptRoot "start-all-listflow-workers.cmd") `
    -WorkingDirectory $repoRoot -WindowStyle Normal
  Write-Host "Update complete. The six-worker controller is opening."
} catch {
  Write-Host ""
  Write-Host "Update failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "No local changes were discarded. Details: $logPath"
  exit 1
} finally {
  if ($transcriptStarted) { Stop-Transcript | Out-Null }
}

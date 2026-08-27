$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logsDir = Join-Path $repoRoot "logs"
$supervisorLockPath = Join-Path $logsDir "local-workers.supervisor.lock"
$supervisorStopPath = Join-Path $logsDir "local-workers.stop"

function Test-ProcessAlive([int]$ProcessId) {
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Test-ListFlowProcess([int]$ProcessId, [string]$ExpectedScript) {
  if (-not (Test-ProcessAlive $ProcessId)) {
    return $false
  }

  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    return $process.CommandLine -and $process.CommandLine.Contains($ExpectedScript)
  } catch {
    # If Windows denies command-line inspection, preserve the live lock instead
    # of risking interference with a worker that is still finishing a job.
    return $true
  }
}

function Get-LiveLockProcesses {
  if (-not (Test-Path -LiteralPath $logsDir)) {
    return @()
  }

  $live = @()
  $lockFiles = Get-ChildItem -LiteralPath $logsDir -Filter "local-*.worker.lock" -File
  foreach ($lockFile in $lockFiles) {
    $processId = 0
    [void][int]::TryParse((Get-Content -LiteralPath $lockFile.FullName -Raw).Trim(), [ref]$processId)
    if ($processId -gt 0 -and (Test-ListFlowProcess $processId "listflow-worker.ts")) {
      $live += [pscustomobject]@{ ProcessId = $processId; LockFile = $lockFile }
    } else {
      Remove-Item -LiteralPath $lockFile.FullName -Force -ErrorAction SilentlyContinue
    }
  }
  return $live
}

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Set-Content -LiteralPath $supervisorStopPath -Value "stop" -Encoding ASCII

$liveWorkers = @(Get-LiveLockProcesses)
foreach ($worker in $liveWorkers) {
  $workerId = $worker.LockFile.Name -replace '\.worker\.lock$', ''
  $workerStopPath = Join-Path $logsDir "$workerId.stop"
  Set-Content -LiteralPath $workerStopPath -Value "stop" -Encoding ASCII
}

if ($liveWorkers.Count -eq 0 -and -not (Test-Path -LiteralPath $supervisorLockPath)) {
  Write-Host "No local ListFlow workers are running."
  Remove-Item -LiteralPath $supervisorStopPath -Force -ErrorAction SilentlyContinue
  exit 0
}

Write-Host "Graceful stop requested. Active jobs will finish before their worker exits."
$lastProgressAt = [DateTime]::MinValue

while ($true) {
  $liveWorkers = @(Get-LiveLockProcesses)
  $supervisorAlive = $false

  if (Test-Path -LiteralPath $supervisorLockPath) {
    $supervisorPid = 0
    [void][int]::TryParse((Get-Content -LiteralPath $supervisorLockPath -Raw).Trim(), [ref]$supervisorPid)
    $supervisorAlive = $supervisorPid -gt 0 -and (Test-ListFlowProcess $supervisorPid "listflow-local-workers.ts")
    if (-not $supervisorAlive) {
      Remove-Item -LiteralPath $supervisorLockPath -Force -ErrorAction SilentlyContinue
    }
  }

  if ($liveWorkers.Count -eq 0 -and -not $supervisorAlive) {
    break
  }

  if (((Get-Date) - $lastProgressAt).TotalSeconds -ge 10) {
    Write-Host "Waiting for $($liveWorkers.Count) worker process(es) to finish..."
    $lastProgressAt = Get-Date
  }
  Start-Sleep -Seconds 1
}

Get-ChildItem -LiteralPath $logsDir -Filter "local-*.stop" -File -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $supervisorStopPath -Force -ErrorAction SilentlyContinue
Write-Host "All local ListFlow workers stopped."

param([ValidateSet('Setup','Preflight','Start','Stop','Status','Diagnostics')][string]$Action)
$ErrorActionPreference = 'Stop'
$workerRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $workerRoot
$envPath = Join-Path $workerRoot '.env'
$manifestPath = Join-Path $workerRoot 'worker-release-manifest.json'
$logsPath = Join-Path $workerRoot 'logs'
$adminScript = Join-Path $workerRoot 'scripts\worker-package-admin.ts'
$env:DOTENV_CONFIG_PATH = $envPath
$env:DOTENV_CONFIG_OVERRIDE = 'true'
if (!(Test-Path -LiteralPath $manifestPath)) { throw 'Release manifest is missing.' }
if (!(Test-Path -LiteralPath $envPath)) { throw 'Private .env is missing. Reinstall the package from the local source.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$env:LISTFLOW_REVISION = $manifest.revision
[IO.Directory]::CreateDirectory($logsPath) | Out-Null

function Invoke-Checked([string]$label, [string]$program, [string[]]$arguments) {
  Write-Host $label
  & $program @arguments
  if ($LASTEXITCODE -ne 0) { throw "$label failed with exit code $LASTEXITCODE." }
}
function Invoke-Admin([string]$operation) {
  Invoke-Checked "Worker $operation" 'node.exe' @('--import','tsx',$adminScript,$operation)
}
function Test-Manifest {
  foreach ($file in $manifest.files) {
    $full = [IO.Path]::GetFullPath((Join-Path $workerRoot $file.path))
    if (!$full.StartsWith($workerRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe manifest path.' }
    if (!(Test-Path -LiteralPath $full -PathType Leaf)) { throw "Release file missing: $($file.path)" }
    if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ne $file.sha256) { throw "Release file changed: $($file.path)" }
  }
  Write-Host "Source manifest verified: $($manifest.revision)"
}
function Show-LocalProcesses {
  $locks = @(Get-ChildItem -LiteralPath $logsPath -Filter 'local-*.lock' -File -ErrorAction SilentlyContinue)
  foreach ($lock in $locks) {
    $lockId = 0
    [void][int]::TryParse((Get-Content -LiteralPath $lock.FullName -Raw).Trim(), [ref]$lockId)
    $process = if ($lockId -gt 0) { Get-CimInstance Win32_Process -Filter "ProcessId = $lockId" -ErrorAction SilentlyContinue } else { $null }
    $expected = if ($lock.Name -eq 'local-workers.supervisor.lock') { 'listflow-local-workers.ts' } else { 'listflow-worker.ts' }
    $verified = $process -and $process.Name -eq 'node.exe' -and $process.CommandLine -match [regex]::Escape($expected)
    Write-Host "$($lock.Name): PID $lockId; matching worker process: $([bool]$verified)"
  }
}
try {
  switch ($Action) {
    'Setup' {
      Test-Manifest
      Invoke-Checked 'Installing exact dependencies' 'npm.cmd' @('ci','--include=dev')
      Invoke-Checked 'Generating Prisma client' 'npm.cmd' @('exec','prisma','generate')
      $browserPath = & node.exe -e 'process.stdout.write(require("playwright").chromium.executablePath())'
      if ($LASTEXITCODE -ne 0) { throw 'Could not resolve Playwright Chromium.' }
      if (!(Test-Path -LiteralPath $browserPath)) {
        Invoke-Checked 'Installing matching Chromium' 'npm.cmd' @('run','browser:install')
      }
      Invoke-Admin 'preflight'
      $desktop = [Environment]::GetFolderPath('Desktop')
      if (!(Test-Path -LiteralPath $desktop)) { throw 'Desktop folder is unavailable; setup could not create worker shortcuts.' }
      $shell = New-Object -ComObject WScript.Shell
      foreach ($shortcut in @(
        @{ Name='Start ListFlow Workers (This PC).lnk'; File='03 Start All Workers.cmd' },
        @{ Name='Stop ListFlow Workers (This PC).lnk'; File='04 Stop All Workers.cmd' },
        @{ Name='ListFlow Worker Status (This PC).lnk'; File='05 Worker Status.cmd' }
      )) {
        $link = $shell.CreateShortcut((Join-Path $desktop $shortcut.Name))
        $link.TargetPath = Join-Path $workerRoot $shortcut.File
        $link.WorkingDirectory = $workerRoot
        $link.Save()
      }
      Write-Host 'Setup completed. Use 03 Start All Workers.cmd.'
    }
    'Preflight' { Test-Manifest; Invoke-Admin 'preflight' }
    'Start' {
      Test-Manifest
      Invoke-Admin 'preflight'
      $out = Join-Path $logsPath 'local-workers-supervisor.out.log'
      $err = Join-Path $logsPath 'local-workers-supervisor.err.log'
      Start-Process -FilePath 'node.exe' -ArgumentList @('--import','tsx','scripts/listflow-local-workers.ts') -WorkingDirectory $workerRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
      $ready = $false
      for ($attempt=0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Seconds 2
        try {
          $result = & node.exe --import tsx $adminScript status 2>$null | Out-String | ConvertFrom-Json
          if ($result.ownWorkersOnline -eq 6 -and $result.foreignWorkersOnline -eq 0 -and $result.activeForeignLeases -eq 0) { $ready = $true; break }
        } catch { }
        $supervisorLock = Join-Path $logsPath 'local-workers.supervisor.lock'
        if (!(Test-Path -LiteralPath $supervisorLock)) { break }
      }
      if (!$ready) { Show-LocalProcesses; throw "Six fresh heartbeats were not confirmed. Review $err and run Worker Status." }
      Show-LocalProcesses
      Write-Host "Six local workers are online at revision $($manifest.revision). Logs: $logsPath"
    }
    'Stop' {
      Invoke-Checked 'Stopping this installation gracefully' 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $workerRoot 'scripts\stop-listflow-workers.ps1'))
      Show-LocalProcesses
    }
    'Status' { Show-LocalProcesses; Invoke-Admin 'status' }
    'Diagnostics' { Invoke-Checked 'Collecting redacted diagnostics' 'node.exe' @((Join-Path $workerRoot 'scripts\collect-worker-diagnostics.mjs')) }
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
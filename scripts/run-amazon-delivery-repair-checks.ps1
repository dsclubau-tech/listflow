param([ValidateSet('diagnostics','stop','baseline','repaired','verify','browser-headless','browser-visible','browser-native')][string]$Action='verify', [string]$WorkerRoot='')
$ErrorActionPreference='Stop'
if ([string]::IsNullOrWhiteSpace($WorkerRoot)) {
  $candidate = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  for ($level = 0; $level -lt 6; $level++) {
    if ((Test-Path -LiteralPath (Join-Path $candidate '.env')) -and
        (Test-Path -LiteralPath (Join-Path $candidate 'node_modules')) -and
        (Test-Path -LiteralPath (Join-Path $candidate 'scripts\listflow-worker.ts'))) {
      $WorkerRoot = $candidate
      break
    }
    $parent = [IO.Directory]::GetParent($candidate)
    if ($null -eq $parent) { break }
    $candidate = $parent.FullName
  }
  if ([string]::IsNullOrWhiteSpace($WorkerRoot)) { throw 'No ListFlow worker checkout was found above this package. Extract it inside the worker folder, or supply -WorkerRoot explicitly.' }
}
$workerFolder=(Resolve-Path -LiteralPath $WorkerRoot).Path
Write-Host ('Worker folder: ' + $workerFolder)
Set-Location -LiteralPath $workerFolder
if (!(Test-Path -LiteralPath (Join-Path $workerFolder '.env')) -or !(Test-Path -LiteralPath (Join-Path $workerFolder 'node_modules'))) { throw 'Extract this package as one folder directly inside the installed worker folder containing .env and node_modules.' }
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$probe=Join-Path $PSScriptRoot 'probe.cjs'
if ((Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash -ne $manifest.probeHash) { throw 'Probe checksum mismatch. Extract a fresh package.' }
$reports=Join-Path $workerFolder 'logs\amazon-delivery-repair'
New-Item -ItemType Directory -Path $reports -Force | Out-Null
$env:DOTENV_CONFIG_PATH=Join-Path $workerFolder '.env'
if ($Action -eq 'diagnostics') {
  & node (Join-Path $workerFolder 'scripts\collect-worker-diagnostics.mjs')
} elseif ($Action -eq 'stop') {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $workerFolder 'scripts\stop-listflow-workers.ps1')
} elseif ($Action -eq 'verify') {
  foreach ($file in $manifest.files) {
    $target=[IO.Path]::GetFullPath((Join-Path $workerFolder $file.path))
    if (!$target.StartsWith($workerFolder + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe manifest path.' }
    if (!(Test-Path -LiteralPath $target)) { throw ('Repair source missing: ' + $file.path) }
    $source=[IO.File]::ReadAllText($target).Replace("`r`n","`n").TrimEnd([char]10)
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($source)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    if ($hash -ne $file.hash) { throw ('Installed source differs from the tested repair: ' + $file.path + '. Update to the coordinated tested release; this command does not overwrite files.') }
  }
  Write-Host 'Installed repair source matches the tested package. This does not prove live Amazon recovery.'
} else {
  $lock=Join-Path $workerFolder 'logs\local-workers.supervisor.lock'
  if (Test-Path -LiteralPath $lock) {
    $supervisorId=0
    [void][int]::TryParse((Get-Content -LiteralPath $lock -Raw).Trim(), [ref]$supervisorId)
    if ($supervisorId -gt 0 -and (Get-Process -Id $supervisorId -ErrorAction SilentlyContinue)) { throw 'Stop the supervisor gracefully before the diagnostic sample, so production checking does not overlap it.' }
  }
  $arguments=@('--output',(Join-Path $reports ($Action + '.json')),'--sample',(Join-Path $reports 'sample.json'))
  if ($Action -eq 'baseline') { $arguments += '--installed' }
  if ($Action -eq 'browser-headless' -or $Action -eq 'browser-visible') {
    $arguments += @('--store-login','store-1','--diagnostic-profile')
    if ($Action -eq 'browser-visible') { $arguments += '--visible' }
    Write-Host 'One-product diagnostic only. A visible browser may open; do not sign in or interact during the test.'
  }
  if ($Action -eq 'browser-native') {
    $arguments += @('--store-login','store-1','--visible','--native-chrome')
    Write-Host 'One-product control using installed Chrome and a fresh session. Do not sign in or interact; your personal Chrome profile is not used.'
  }
  & node --import tsx $probe @arguments
}
if ($LASTEXITCODE -eq 2) { Write-Host 'No rollout: not every configured store has a verified result. Preserve these reports and investigate the endpoint/page failures.' -ForegroundColor Yellow; exit 2 }
if ($Action -ne 'verify' -and $LASTEXITCODE -ne 0) { throw ('Diagnostic command failed with exit code ' + $LASTEXITCODE) }
Write-Host ('Reports: ' + $reports)
Write-Host 'No rollout, restart, configuration change, or product/eBay write was performed by the probe.'

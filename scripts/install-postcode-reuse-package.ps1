param(
  [string]$WorkerRoot = (Join-Path $PSScriptRoot ".."),
  [switch]$ValidateOnly
)
$ErrorActionPreference = "Stop"
$workerFolder = (Resolve-Path -LiteralPath $WorkerRoot).Path.TrimEnd("\")
$packageFolder = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $packageFolder "manifest.json") -Raw | ConvertFrom-Json
function Source-Hash([string]$File) {
  $content = [IO.File]::ReadAllText($File).Replace("`r`n", "`n").TrimEnd([char]10)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($content)))).Replace("-", "").ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}
function Safe-Target([string]$Relative) {
  $target = [IO.Path]::GetFullPath((Join-Path $workerFolder $Relative))
  if (!$target.StartsWith($workerFolder + "\", [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe package path." }
  if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Package target is a reparse point: $target" }
  $parent = Split-Path -Parent $target
  while ($parent -and $parent -ne $workerFolder) {
    if ((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Package target uses a reparse point: $parent" }
    $parent = Split-Path -Parent $parent
  }
  return $target
}
if (!(Test-Path -LiteralPath (Join-Path $workerFolder ".env")) -or
    !(Test-Path -LiteralPath (Join-Path $workerFolder "node_modules\.bin\tsx.cmd"))) {
  throw "Extract postcode-reuse-rollout into the ListFlow worker folder containing .env and node_modules."
}
foreach ($entry in $manifest.files) {
  $target = Safe-Target $entry.path
  $payload = Join-Path (Join-Path $packageFolder "payload") $entry.path
  if ((Source-Hash $payload) -ne $entry.installedHash) { throw "Package payload checksum failed: $($entry.path)" }
  if (Test-Path -LiteralPath $target) {
    $hash = Source-Hash $target
    if ($hash -ne $entry.installedHash -and $hash -ne $entry.baselineHash) {
      throw "Worker file differs from the tested baseline: $($entry.path). No files changed. Update the worker copy to the matching baseline first."
    }
  } elseif ($entry.baselineHash) { throw "Required worker file is missing: $($entry.path)" }
}
Write-Host "All package paths and source checksums verified."
if ($ValidateOnly) { exit 0 }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $workerFolder "scripts\stop-listflow-workers.ps1")
if ($LASTEXITCODE -ne 0) { throw "Workers did not stop gracefully; no source files changed." }
$backup = Join-Path $workerFolder ("logs\postcode-reuse-code-backup\" + (Get-Date -Format "yyyyMMdd-HHmmssfff"))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$changed = @()
try {
  foreach ($entry in $manifest.files) {
    $target = Safe-Target $entry.path
    $previous = Join-Path $backup $entry.path
    $existed = Test-Path -LiteralPath $target
    if ($existed) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $previous) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $previous
    }
    $changed += [pscustomobject]@{ Target = $target; Previous = $previous; Existed = $existed }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path (Join-Path $packageFolder "payload") $entry.path) -Destination $target
    if ((Source-Hash $target) -ne $entry.installedHash) { throw "Installed file checksum failed." }
  }
} catch {
  foreach ($entry in $changed) {
    if ($entry.Existed) { Copy-Item -LiteralPath $entry.Previous -Destination $entry.Target -Force }
    else { Remove-Item -LiteralPath $entry.Target -Force -ErrorAction SilentlyContinue }
  }
  throw
}
Write-Host ("Code installed; original files backed up in " + $backup)
Write-Host "Workers remain stopped. Run 03 Audit, then 04 Enable after the audit passes."
Write-Host "Your .env and product data were preserved. No eBay actions were submitted."

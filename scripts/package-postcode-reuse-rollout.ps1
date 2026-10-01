param([string]$OutputRoot = (Join-Path $PSScriptRoot "..\scratch"))
$ErrorActionPreference = "Stop"
$repoFolder = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageFolder = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) "postcode-reuse-rollout"
New-Item -ItemType Directory -Path $packageFolder -Force | Out-Null
$files = @(
  "lib/price-check-optimizations.ts", "lib/price-check-rollout.ts", "lib/price-checker.ts",
  "lib/postcode-reuse-rollout-verification.ts", "scripts/listflow-worker.ts",
  "scripts/configure-postcode-reuse.ts", "scripts/postcode-reuse-preflight.ts",
  "scripts/postcode-reuse-evidence.ts", "scripts/postcode-reuse-rollout.ps1"
)
function Text-Hash([string]$Content) {
  $content = $Content.Replace("`r`n", "`n").TrimEnd([char]10)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($content)))).Replace("-", "").ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}
$entries = @()
foreach ($file in $files) {
  $source = Join-Path $repoFolder $file
  $destination = Join-Path (Join-Path $packageFolder "payload") $file
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  $baseline = ""
  $tracked = & git -C $repoFolder ls-tree --name-only HEAD -- $file
  if ($tracked) {
    $baselineText = (& git -C $repoFolder show ("HEAD:" + $file)) -join "`n"
    $baseline = Text-Hash $baselineText
  }
  $entries += [pscustomobject]@{ path = $file; baselineHash = $baseline; installedHash = (Text-Hash ([IO.File]::ReadAllText($source))) }
}
$revision = (& git -C $repoFolder rev-parse HEAD | Out-String).Trim()
[IO.File]::WriteAllText((Join-Path $packageFolder "manifest.json"), (@{ baselineRevision = $revision; files = $entries } | ConvertTo-Json -Depth 5))
Copy-Item -LiteralPath (Join-Path $repoFolder "scripts\install-postcode-reuse-package.ps1") -Destination (Join-Path $packageFolder "Install.ps1") -Force
Copy-Item -LiteralPath (Join-Path $repoFolder "POSTCODE_REUSE_PACKAGE_README.txt") -Destination (Join-Path $packageFolder "README.txt") -Force
$actions = [ordered]@{ "02 Preflight" = "preflight"; "03 Audit" = "audit"; "04 Enable All Stores" = "enable"; "05 Disable One Store" = "disable-store"; "06 Enable One Store" = "enable-store"; "07 Disable All Stores" = "off" }
[IO.File]::WriteAllText((Join-Path $packageFolder "01 Install.cmd"), ('@echo off' + [Environment]::NewLine + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" -WorkerRoot "%~dp0.."' + [Environment]::NewLine + 'pause'))
foreach ($entry in $actions.GetEnumerator()) {
  $launcher = '@echo off' + [Environment]::NewLine +
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\postcode-reuse-rollout.ps1" -WorkerRoot "%~dp0.." -Action ' + $entry.Value +
    [Environment]::NewLine + 'pause' + [Environment]::NewLine
  [IO.File]::WriteAllText((Join-Path $packageFolder ($entry.Key + ".cmd")), $launcher)
}
$zip = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) "postcode-reuse-rollout.zip"
Compress-Archive -LiteralPath $packageFolder -DestinationPath $zip -Force
Write-Host ("Package saved: " + $zip)

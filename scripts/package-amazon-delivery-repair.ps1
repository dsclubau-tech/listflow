param([string]$OutputRoot = (Join-Path $PSScriptRoot '..\scratch'))
$ErrorActionPreference = 'Stop'
$repoFolder = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$packageFolder = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) 'amazon-delivery-repair-checks'
New-Item -ItemType Directory -Path $packageFolder -Force | Out-Null
$probe = Join-Path $packageFolder 'probe.cjs'
& (Join-Path $repoFolder 'node_modules\.bin\esbuild.cmd') (Join-Path $repoFolder 'scripts\amazon-delivery-repair-probe.ts') --bundle --platform=node --format=cjs --packages=external "--outfile=$probe"
if ($LASTEXITCODE -ne 0) { throw 'Could not bundle the read-only diagnostic probe.' }
function Source-Hash([string]$File) {
  $source = [IO.File]::ReadAllText($File).Replace("`r`n", "`n").TrimEnd([char]10)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($source)))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
$files = @('lib/amazon-scraper.ts','lib/amazon-delivery-recovery.ts','lib/amazon-delivery-cooldown.ts','lib/price-check-failures.ts',
  'lib/price-checker.ts','lib/price-check-jobs.ts','lib/price-check-item-scheduler.ts','lib/amazon-delivery-wait.ts',
  'components/ProductsPageClient.tsx','components/ActionProgressBar.tsx','app/api/job-history/route.ts','app/(app)/history/page.tsx')
$manifest = @{ format='listflow-delivery-repair-package-v1'; builtAt=(Get-Date).ToUniversalTime().ToString('o');
  sourceRevision=(& git -C $repoFolder rev-parse HEAD); probeHash=(Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash;
  files=@($files | ForEach-Object { @{ path=$_; hash=(Source-Hash (Join-Path $repoFolder $_)) } }) }
[IO.File]::WriteAllText((Join-Path $packageFolder 'manifest.json'), ($manifest | ConvertTo-Json -Depth 6))
Copy-Item -LiteralPath (Join-Path $repoFolder 'scripts\run-amazon-delivery-repair-checks.ps1') -Destination (Join-Path $packageFolder 'Run.ps1') -Force
Copy-Item -LiteralPath (Join-Path $repoFolder 'docs\amazon-delivery-recovery.md') -Destination (Join-Path $packageFolder 'README.txt') -Force
Copy-Item -LiteralPath (Join-Path $repoFolder 'docs\live-worker-verification.md') -Destination (Join-Path $packageFolder 'VERIFICATION.txt') -Force
Copy-Item -LiteralPath (Join-Path $repoFolder 'docs\live-worker-verification.md') -Destination (Join-Path $packageFolder 'LIVE-VERIFICATION.txt') -Force
Copy-Item -LiteralPath (Join-Path $repoFolder 'docs\worker-operations.md') -Destination (Join-Path $packageFolder 'docs\worker-operations.md') -Force
$actions = [ordered]@{'01 Collect diagnostics'='diagnostics';'02 Stop workers gracefully'='stop';'03 Installed baseline probe'='baseline';'04 Repaired read-only probe'='repaired';'05 Verify installed source'='verify';'06 One-product headless diagnostic'='browser-headless';'07 One-product visible diagnostic'='browser-visible';'08 Native Chrome diagnostic'='browser-native'}
foreach ($entry in $actions.GetEnumerator()) {
  $command = '@echo off' + [Environment]::NewLine + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run.ps1" -Action ' + $entry.Value + [Environment]::NewLine + 'pause' + [Environment]::NewLine
  [IO.File]::WriteAllText((Join-Path $packageFolder ($entry.Key + '.cmd')), $command)
}
$zip = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) 'amazon-delivery-repair-checks.zip'
Compress-Archive -LiteralPath $packageFolder -DestinationPath $zip -Force
Write-Host $zip

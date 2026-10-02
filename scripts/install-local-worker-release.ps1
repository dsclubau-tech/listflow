param(
  [Parameter(Mandatory=$true)][string]$PackageZip,
  [string]$Target = 'D:\ListFlow-Workers',
  [string]$SourceEnv = 'D:\listflow\.env'
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath=(Resolve-Path -LiteralPath $PackageZip).Path
$sourcePath=(Resolve-Path -LiteralPath $SourceEnv).Path
$targetPath=[IO.Path]::GetFullPath($Target).TrimEnd([IO.Path]::DirectorySeparatorChar)
if ($targetPath -eq [IO.Path]::GetFullPath('D:\listflow').TrimEnd([IO.Path]::DirectorySeparatorChar)) {
  throw 'The worker installation must not replace the development checkout.'
}
if (Test-Path -LiteralPath $targetPath) {
  if (@(Get-ChildItem -LiteralPath $targetPath -Force).Count -gt 0) { throw "Target is not empty: $targetPath" }
} else { [IO.Directory]::CreateDirectory($targetPath) | Out-Null }
$zip=[IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  foreach ($entry in $zip.Entries) {
    $relative=$entry.FullName.Replace('/','\')
    $resolved=[IO.Path]::GetFullPath((Join-Path $targetPath $relative))
    if (!$resolved.StartsWith($targetPath + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Release ZIP contains an unsafe path.' }
  }
} finally { $zip.Dispose() }
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $targetPath -Force
  $manifestPath=Join-Path $targetPath 'worker-release-manifest.json'
  if (!(Test-Path -LiteralPath $manifestPath)) { throw 'Package manifest is missing.' }
  $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.format -ne 'listflow-local-workers-release-v1' -or $manifest.revision -notmatch '^[a-f0-9]{40}$') { throw 'Invalid release manifest.' }
  foreach ($file in $manifest.files) {
    $absolute=[IO.Path]::GetFullPath((Join-Path $targetPath $file.path))
    if (!$absolute.StartsWith($targetPath + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe release file path.' }
    if (!(Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "Release file missing: $($file.path)" }
    if ((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash -ne $file.sha256) { throw "Release file checksum mismatch: $($file.path)" }
  }
  $existing=[IO.File]::ReadAllLines($sourcePath)
  $otherFeatures=@()
  $managed=@('LISTFLOW_WORKER_DATABASE_PROFILE','LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS','LISTFLOW_LOCAL_WORKER_INSTANCE_ID',
    'LISTFLOW_USE_LOCAL_PLAYWRIGHT','LISTFLOW_PRICE_CHECK_OPTIMIZATIONS','LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE',
    'LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS','LISTFLOW_PRICE_CHECK_TIMING_ENABLED')
  $lines=New-Object 'System.Collections.Generic.List[string]'
  foreach ($line in $existing) {
    if ($line -match '^\s*LISTFLOW_PRICE_CHECK_OPTIMIZATIONS\s*=\s*(.+?)\s*$') {
      $otherFeatures += ($Matches[1].Trim('"', "'", ' ') -split ',')
    }
    $name=($line -split '=',2)[0].Trim()
    if ($managed -contains $name -or $name -match '^(NEXTAUTH_URL|AUTH_URL|LISTFLOW_E2E_.*|PORT|HOSTNAME)$') { continue }
    $lines.Add($line)
  }
  $features=@($otherFeatures | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne 'delivery-state' } | Select-Object -Unique) + @('delivery-state')
  $savedInstance=@($existing | Where-Object { $_ -match '^\s*LISTFLOW_LOCAL_WORKER_INSTANCE_ID\s*=' } | ForEach-Object { ($_ -split '=',2)[1].Trim('"',"'",' ') } | Select-Object -Last 1)
  $instance=if ($savedInstance.Count -gt 0 -and $savedInstance[0]) { [string]$savedInstance[0] } else { 'pc-' + [guid]::NewGuid().ToString('N').Substring(0,10) }
  if ($instance -notmatch '^[a-z0-9][a-z0-9-]{0,31}$') { throw 'Existing worker installation ID is invalid.' }
  foreach ($setting in @(
    'LISTFLOW_WORKER_DATABASE_PROFILE=deployed',
    'LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS=store-1,aussiewalmartonline,oz-metro',
    "LISTFLOW_LOCAL_WORKER_INSTANCE_ID=$instance",
    'LISTFLOW_USE_LOCAL_PLAYWRIGHT=true',
    "LISTFLOW_PRICE_CHECK_OPTIMIZATIONS=$($features -join ',')",
    'LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE=all',
    'LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS=',
    'LISTFLOW_PRICE_CHECK_TIMING_ENABLED=true'
  )) { $lines.Add($setting) }
  $privateEnv=Join-Path $targetPath '.env'
  [IO.File]::WriteAllLines($privateEnv,$lines,[Text.UTF8Encoding]::new($false))
  $acl=Get-Acl -LiteralPath $privateEnv
  $acl.SetAccessRuleProtection($true,$false)
  $currentUser=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $system=[Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid,$null)
  foreach ($sid in @($currentUser,$system)) {
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $privateEnv -AclObject $acl
  Write-Host "Installed release $($manifest.revision) at $targetPath"
  Write-Host 'Private configuration copied and restricted to this user and Local System.'
  Write-Host 'Next: run 01 Setup.cmd from the installed worker folder.'
} catch {
  Write-Error "Installation failed: $($_.Exception.Message). Inspect the target before retrying."
  exit 1
}
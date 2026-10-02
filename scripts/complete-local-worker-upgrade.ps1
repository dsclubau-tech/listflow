param(
  [ValidateSet('Verify','Run')][string]$Mode='Verify',
  [Parameter(Mandatory=$true)][string]$PackageZip,
  [string]$WorkerRoot='D:\ListFlow-Workers'
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Get-SourceHash([string]$path) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path))).Replace('-','') }
  finally { $sha.Dispose() }
}$root=[IO.Path]::GetFullPath($WorkerRoot).TrimEnd('\')
if (!$root.Equals('D:\ListFlow-Workers',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected worker installation target.' }
$repo=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package=(Resolve-Path -LiteralPath $PackageZip).Path
$packageRoot=[IO.Path]::GetFullPath((Join-Path $repo 'scratch\local-worker-release')).TrimEnd('\')
if (!$package.StartsWith($packageRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Package must be the reviewed release archive.' }
$oldManifestPath=Join-Path $root 'worker-release-manifest.json'
$oldManifest=Get-Content -LiteralPath $oldManifestPath -Raw|ConvertFrom-Json
if ($oldManifest.format -ne 'listflow-local-workers-release-v1') { throw 'Installed release manifest is invalid.' }
$zip=[IO.Compression.ZipFile]::OpenRead($package)
try {
  $entry=$zip.GetEntry('worker-release-manifest.json')
  if (!$entry) { throw 'New package manifest is missing.' }
  $reader=[IO.StreamReader]::new($entry.Open())
  try { $newManifest=$reader.ReadToEnd()|ConvertFrom-Json } finally { $reader.Dispose() }
  foreach($item in $zip.Entries) {
    $path=[IO.Path]::GetFullPath((Join-Path $root $item.FullName.Replace('/','\')))
    if (!$path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Release ZIP contains an unsafe path.' }
  }
} finally { $zip.Dispose() }
if ($newManifest.format -ne 'listflow-local-workers-release-v1' -or $newManifest.revision -notmatch '^[a-f0-9]{40}$') { throw 'New release manifest is invalid.' }
$oldPaths=@($oldManifest.files|ForEach-Object path|Sort-Object)
$newPaths=@($newManifest.files|ForEach-Object path|Sort-Object)
if (@($oldPaths | Where-Object { $newPaths -notcontains $_ }).Count) { throw 'Release removes source files; this in-place upgrade needs manual review.' }
foreach($file in $oldManifest.files) {
  $full=[IO.Path]::GetFullPath((Join-Path $root $file.path))
  if (!$full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $full -PathType Leaf)) { throw "Installed source missing: $($file.path)" }
  if ((Get-SourceHash $full) -ne $file.sha256) { throw "Installed source changed: $($file.path)" }
}
$changes=@($newManifest.files|Where-Object {
  $candidate=$_
  $prior=$oldManifest.files|Where-Object path -eq $candidate.path|Select-Object -First 1
  if (!$prior -and (Test-Path -LiteralPath (Join-Path $root $candidate.path))) { throw "Unexpected existing source: $($candidate.path)" }
  !$prior -or $prior.sha256 -ne $candidate.sha256
})
Write-Host "Current revision: $($oldManifest.revision)"
Write-Host "Next revision: $($newManifest.revision); changed source files: $($changes.Count)"
if ($Mode -eq 'Verify') { Write-Host 'Read-only upgrade verification passed.'; exit 0 }

$stage=Join-Path $repo ('scratch\upgrade-stage-'+$newManifest.revision.Substring(0,12))
$backup=Join-Path $repo ('diagnostics\worker-upgrade-'+(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $stage) { throw "Staging folder exists: $stage" }
if (Test-Path -LiteralPath $backup) { throw "Backup folder exists: $backup" }
[IO.Directory]::CreateDirectory($stage)|Out-Null
Expand-Archive -LiteralPath $package -DestinationPath $stage
foreach($file in $newManifest.files) {
  $full=[IO.Path]::GetFullPath((Join-Path $stage $file.path))
  if (!$full.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $full -PathType Leaf)) { throw "Package source missing: $($file.path)" }
  if ((Get-SourceHash $full) -ne $file.sha256) { throw "Package source checksum mismatch: $($file.path)" }
}
[IO.Directory]::CreateDirectory($backup)|Out-Null
$backupAcl=Get-Acl -LiteralPath $backup
$backupAcl.SetAccessRuleProtection($true,$false)
foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,
  [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid,$null))) {
  $backupAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
}
Set-Acl -LiteralPath $backup -AclObject $backupAcl
Copy-Item -LiteralPath (Join-Path $root '.env') -Destination (Join-Path $backup 'worker-env.private')
Copy-Item -LiteralPath $oldManifestPath -Destination (Join-Path $backup 'old-manifest.json')
foreach($file in $changes) {
  if ($oldPaths -notcontains $file.path) { continue }
  $destination=Join-Path $backup $file.path
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))|Out-Null
  Copy-Item -LiteralPath (Join-Path $root $file.path) -Destination $destination
}
Write-Host "Private rollback source preserved: $backup"
Write-Host 'Requesting graceful shutdown. Active jobs will finish before workers exit.'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'worker-package\Manage.ps1') -Action Stop
if ($LASTEXITCODE -ne 0) { throw 'Graceful worker stop failed; no release files were changed.' }
$env:DOTENV_CONFIG_PATH=Join-Path $root '.env'
$env:DOTENV_CONFIG_OVERRIDE='true'
$admin=Join-Path $root 'scripts\worker-package-admin.ts'
$clear=$false
for($attempt=0;$attempt -lt 90;$attempt++) {
  $status=& node.exe --import tsx $admin status 2>$null|Out-String|ConvertFrom-Json
  if ($LASTEXITCODE -eq 0 -and $status.ownWorkersOnline -eq 0 -and $status.foreignWorkersOnline -eq 0 -and $status.activeForeignLeases -eq 0) { $clear=$true; break }
  Start-Sleep -Seconds 5
}
if (!$clear) { throw 'Worker heartbeats or leases did not clear; old source remains installed.' }
foreach($file in $changes) { Copy-Item -LiteralPath (Join-Path $stage $file.path) -Destination (Join-Path $root $file.path) -Force }
Copy-Item -LiteralPath (Join-Path $stage 'worker-release-manifest.json') -Destination $oldManifestPath -Force
Write-Host 'Source overlay installed; private configuration, dependencies, logs, and installation ID preserved.'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'worker-package\Manage.ps1') -Action Start
if ($LASTEXITCODE -ne 0) { throw 'New supervisor did not pass startup verification. Workers were not restarted from the old release.' }
Write-Host "Graceful upgrade completed at revision $($newManifest.revision)."
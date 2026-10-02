param(
  [string]$OldRoot='D:\listflow',
  [string]$NewRoot='D:\ListFlow-Workers'
)
$ErrorActionPreference='Stop'
$old=(Resolve-Path -LiteralPath $OldRoot).Path
$new=(Resolve-Path -LiteralPath $NewRoot).Path
if (!$old.Equals([IO.Path]::GetFullPath('D:\listflow').TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) {
  throw 'Retirement is limited to the known development checkout.'
}
if (!$new.Equals([IO.Path]::GetFullPath('D:\ListFlow-Workers').TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) {
  throw 'New worker installation path does not match the reviewed target.'
}
$manifest=Get-Content -LiteralPath (Join-Path $new 'worker-release-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 'listflow-local-workers-release-v1') { throw 'New release manifest is invalid.' }
$env:DOTENV_CONFIG_PATH=Join-Path $new '.env'
$env:DOTENV_CONFIG_OVERRIDE='true'
$env:LISTFLOW_REVISION=$manifest.revision
Push-Location -LiteralPath $new
try {
  $status=& node.exe --import tsx scripts/worker-package-admin.ts status | Out-String | ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or $status.ownWorkersOnline -ne 6 -or $status.foreignWorkersOnline -ne 0){
    throw 'The new six-worker release is not fully online or a competing worker remains.'
  }
} finally { Pop-Location }
$logs=Join-Path $old 'logs'
$locks=@(Get-ChildItem -LiteralPath $logs -Filter '*.lock' -File -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match '^(local-|worker-|manual-|codex-).+\.lock$'
})
foreach ($lock in $locks) {
  $id=0
  [void][int]::TryParse((Get-Content -LiteralPath $lock.FullName -Raw).Trim(),[ref]$id)
  $process=if($id -gt 0){ Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue }else{$null}
  $script=if($lock.Name -eq 'local-workers.supervisor.lock'){'listflow-local-workers.ts'}else{'listflow-worker.ts'}
  if($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -match [regex]::Escape($script)) {
    throw "Old worker remains active: $($lock.Name). Stop it gracefully before retiring its lock."
  }
}
$backup=Join-Path $old ('diagnostics\old-local-workers-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
[IO.Directory]::CreateDirectory($backup)|Out-Null
$acl=Get-Acl -LiteralPath $backup
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,
  [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid,$null))) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',
    'ContainerInherit,ObjectInherit','None','Allow'))
}
Set-Acl -LiteralPath $backup -AclObject $acl
$backupLogs=Join-Path $backup 'logs'
[IO.Directory]::CreateDirectory($backupLogs)|Out-Null
foreach($file in (Get-ChildItem -LiteralPath $logs -File -ErrorAction SilentlyContinue)) {
  Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $backupLogs $file.Name)
}
Copy-Item -LiteralPath (Join-Path $old '.env') -Destination (Join-Path $backup 'development-env.private')
$desktop=[Environment]::GetFolderPath('Desktop')
$shortcuts=@()
if(Test-Path -LiteralPath $desktop){
  $shell=New-Object -ComObject WScript.Shell
  foreach($file in (Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -File)) {
    $link=$shell.CreateShortcut($file.FullName)
    if($link.TargetPath.StartsWith($old + '\',[StringComparison]::OrdinalIgnoreCase) -and $file.Name -match 'ListFlow|Worker') {
      $shortcuts += $file.FullName
    }
  }
}
$inventory=[pscustomobject]@{ oldRoot=$old; newRoot=$new; revision=$manifest.revision;
  locks=@($locks | ForEach-Object{$_.Name}); shortcuts=$shortcuts }
[IO.File]::WriteAllText((Join-Path $backup 'inventory.json'),($inventory|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
foreach($lock in $locks){ Remove-Item -LiteralPath $lock.FullName -Force }
foreach($stop in (Get-ChildItem -LiteralPath $logs -Filter '*.stop' -File -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match '^(local-|worker-|manual-|codex-).+\.stop$'
})) { Remove-Item -LiteralPath $stop.FullName -Force }
foreach($shortcut in $shortcuts){ Remove-Item -LiteralPath $shortcut -Force }
Write-Host "Retired $($locks.Count) stale locks and $($shortcuts.Count) old checkout shortcuts."
Write-Host "Private backup: $backup"
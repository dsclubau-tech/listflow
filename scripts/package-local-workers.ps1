param([string]$OutputRoot = (Join-Path $PSScriptRoot '..\scratch\local-worker-release'))
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$dirty = (& git -C $repo status --porcelain --untracked-files=all | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit and review all source changes before building a worker release.' }
$revision = (& git -C $repo rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Could not resolve release revision.' }
$output = [IO.Path]::GetFullPath($OutputRoot)
[IO.Directory]::CreateDirectory($output) | Out-Null
$staging = Join-Path $output ('stage-' + $revision.Substring(0,12))
if (Test-Path -LiteralPath $staging) { throw "Staging folder already exists: $staging" }
[IO.Directory]::CreateDirectory($staging) | Out-Null
$sourceZip = Join-Path $output ('source-' + $revision.Substring(0,12) + '.zip')
$releaseZip = Join-Path $output ('ListFlow-Workers-' + $revision.Substring(0,12) + '.zip')
if (Test-Path -LiteralPath $releaseZip) { throw 'Release ZIP already exists; refusing to overwrite it.' }
try {
  & git -C $repo archive --format=zip -o $sourceZip HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Git archive failed.' }
  Expand-Archive -LiteralPath $sourceZip -DestinationPath $staging
  $commands = Join-Path $staging 'worker-package'
  foreach ($launcher in (Get-ChildItem -LiteralPath $commands -Filter '*.cmd' -File)) {
    Copy-Item -LiteralPath $launcher.FullName -Destination (Join-Path $staging $launcher.Name)
  }
  $files = foreach ($file in (Get-ChildItem -LiteralPath $staging -File -Recurse)) {
    $relative = $file.FullName.Substring($staging.Length + 1).Replace('\','/')
    [pscustomobject]@{ path=$relative; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
  }
  $playwrightPackage=Get-Content -LiteralPath (Join-Path $repo 'node_modules\playwright\package.json') -Raw | ConvertFrom-Json
  $browserCatalog=Get-Content -LiteralPath (Join-Path $repo 'node_modules\playwright-core\browsers.json') -Raw | ConvertFrom-Json
  $chromiumRevision=($browserCatalog.browsers | Where-Object name -eq 'chromium' | Select-Object -First 1).revision
  if (!$playwrightPackage.version -or !$chromiumRevision) { throw 'Playwright version or browser revision is missing.' }
  $browserExecutable=Join-Path $env:LOCALAPPDATA "ms-playwright\chromium-$chromiumRevision\chrome-win64\chrome.exe"
  $manifest = [pscustomobject]@{
    format='listflow-local-workers-release-v1'
    revision=$revision
    builtAt=(Get-Date).ToUniversalTime().ToString('o')
    node=(node.exe --version)
    playwright=$playwrightPackage.version
    browserRevision=$chromiumRevision
    browserExecutable=$browserExecutable
    files=@($files)
  }
  [IO.File]::WriteAllText((Join-Path $staging 'worker-release-manifest.json'),
    ($manifest | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $releaseZip -CompressionLevel Optimal
  Write-Host "Worker release: $releaseZip"
  Write-Host "Revision: $revision; source files: $(@($files).Count)"
} finally {
  if (Test-Path -LiteralPath $sourceZip) { Remove-Item -LiteralPath $sourceZip -Force }
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
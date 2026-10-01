$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

try {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install Node.js 22, then collect diagnostics again."
  }
  Write-Host "Collecting recent logs and a redacted system report..."
  $result = & node.exe (Join-Path $PSScriptRoot "collect-worker-diagnostics.mjs")
  if ($LASTEXITCODE -ne 0) { throw "The diagnostics collector failed. No archive was created." }
  $reportPath = ($result | Out-String).Trim()
  $resolvedReport = (Resolve-Path -LiteralPath $reportPath).Path
  $expectedDirectory = [IO.Path]::GetFullPath((Join-Path $repoRoot "diagnostics")) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedReport.StartsWith($expectedDirectory, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($resolvedReport) -ne ".json") {
    throw "The collector returned an unexpected report path."
  }
  $zipPath = [IO.Path]::ChangeExtension($resolvedReport, ".zip")
  Compress-Archive -LiteralPath $resolvedReport -DestinationPath $zipPath
  Remove-Item -LiteralPath $resolvedReport
  Write-Host ""
  Write-Host "Diagnostics saved: $zipPath" -ForegroundColor Green
  Write-Host "Share this ZIP in the ListFlow support chat, with the time and action that failed."
  Write-Host "Credentials are masked. Review the report before sharing; operational IDs may remain."
} catch {
  Write-Host "Diagnostics failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

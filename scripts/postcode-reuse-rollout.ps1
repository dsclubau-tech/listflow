param(
  [ValidateSet("preflight", "audit", "enable", "off", "disable-store", "enable-store")]
  [string]$Action = "preflight",
  [string]$WorkerRoot = (Join-Path $PSScriptRoot ".."),
  [string]$StoreLoginId
)
$ErrorActionPreference = "Stop"
$workerFolder = (Resolve-Path -LiteralPath $WorkerRoot).Path
Set-Location -LiteralPath $workerFolder
$tsx = Join-Path $workerFolder "node_modules\.bin\tsx.cmd"
$envFile = Join-Path $workerFolder ".env"
if (!(Test-Path -LiteralPath $tsx) -or !(Test-Path -LiteralPath $envFile)) {
  throw "Run from an installed ListFlow worker folder containing .env and node_modules."
}
$env:DOTENV_CONFIG_PATH = $envFile
$reportsRoot = Join-Path $workerFolder "logs\postcode-reuse-rollout"
New-Item -ItemType Directory -Path $reportsRoot -Force | Out-Null

function Invoke-Tool([string]$Script, [string[]]$Arguments) {
  & $tsx $Script @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Script failed with exit code $LASTEXITCODE. Settings were not activated." }
}
function Stop-Workers {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $workerFolder "scripts\stop-listflow-workers.ps1")
  if ($LASTEXITCODE -ne 0) { throw "Workers did not stop gracefully." }
}
function Start-Workers {
  # The restarted supervisor must load the updated file, rather than matching but now stale inherited values.
  $keys = @("LISTFLOW_PRICE_CHECK_OPTIMIZATIONS", "LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS",
    "LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE", "LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS",
    "LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS", "LISTFLOW_PRICE_CHECK_TIMING_ENABLED",
    "LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MIN_MS", "LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MAX_MS",
    "LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS")
  $previous = @{}
  try {
    foreach ($key in $keys) {
      $previous[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
      [Environment]::SetEnvironmentVariable($key, $null, "Process")
    }
    Start-Process -FilePath (Join-Path $workerFolder "scripts\start-all-listflow-workers.cmd") -WorkingDirectory $workerFolder -WindowStyle Hidden
  } finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], "Process") }
  }
}
function Save-Configuration([string]$Mode, [string]$StoreId) {
  $parameters = @("--env-file", $envFile, "--mode", $Mode)
  if ($StoreId) { $parameters += @("--store-id", $StoreId) }
  Invoke-Tool "scripts\configure-postcode-reuse.ts" $parameters
  Copy-Item -LiteralPath $envFile -Destination ($envFile + ".postcode-reuse-" + (Get-Date -Format "yyyyMMdd-HHmmssfff") + ".bak")
  Invoke-Tool "scripts\configure-postcode-reuse.ts" ($parameters + @("--write"))
}
function Resolve-Store([string]$Folder) {
  if (!$StoreLoginId) { $script:StoreLoginId = Read-Host "Store login ID or database ID (shown by preflight)" }
  $preflight = Get-Content -LiteralPath (Join-Path $Folder "preflight.json") -Raw | ConvertFrom-Json
  $matches = @($preflight.stores | Where-Object { $_.id -eq $StoreLoginId -or $_.loginId -eq $StoreLoginId })
  if ($matches.Count -ne 1) { throw "Store was not found among the configured worker stores." }
  return $matches[0].id
}
try {
  if ($Action -eq "off") {
    Stop-Workers
    Save-Configuration "off" ""
    Start-Workers
    Write-Host "Postcode reuse disabled globally. Other flags preserved."
    exit 0
  }
  $folder = Join-Path $reportsRoot ((Get-Date -Format "yyyyMMdd-HHmmssfff") + "-" + $Action)
  Invoke-Tool "scripts\postcode-reuse-preflight.ts" @("--output", $folder)
  if ($Action -eq "preflight") { exit 0 }
  if ($Action -eq "audit") {
    Invoke-Tool "scripts\postcode-reuse-preflight.ts" @("--output", $folder, "--inputs")
    $wasRunning = Test-Path -LiteralPath (Join-Path $workerFolder "logs\local-workers.supervisor.lock")
    Stop-Workers
    try {
      $preflight = Get-Content -LiteralPath (Join-Path $folder "preflight.json") -Raw | ConvertFrom-Json
      foreach ($store in $preflight.stores) {
        Write-Host ("Comparing 30 products for " + $store.name + " using Amazon postcode " + $store.postcode)
        Invoke-Tool "scripts\compare-price-check-scrapers.ts" @("--input", (Join-Path $folder ($store.loginId + ".input.json")), "--output", (Join-Path $folder ($store.loginId + ".report.json")), "--optimizations", "delivery-state")
      }
      Invoke-Tool "scripts\postcode-reuse-evidence.ts" @("--folder", $folder)
      [IO.File]::WriteAllText((Join-Path $reportsRoot "latest-verified.txt"), $folder)
      Write-Host ("Reports saved in " + $folder)
    } finally { if ($wasRunning) { Start-Workers } }
  } elseif ($Action -eq "enable") {
    $latest = (Get-Content -LiteralPath (Join-Path $reportsRoot "latest-verified.txt") -Raw).Trim()
    if (!(Test-Path -LiteralPath $latest)) { throw "Run the audit successfully before enabling." }
    Invoke-Tool "scripts\postcode-reuse-evidence.ts" @("--folder", $latest, "--current", $folder)
    $current = Get-Content -LiteralPath (Join-Path $folder "preflight.json") -Raw | ConvertFrom-Json
    $blocked = @($current.stores | Where-Object { $current.optimizations.deliveryStateDisabledStoreIds -contains $_.id })
    if ($blocked.Count) { throw "Configured stores have explicit exclusions. Use enable-store to clear intentional exclusions individually, then audit again." }
    Stop-Workers
    Save-Configuration "all" ""
    Start-Workers
    Write-Host "All-store postcode reuse enabled. Check effective startup settings for both workers per store."
  } else {
    $storeId = ""
    if ($Action -ne "off") { $storeId = Resolve-Store $folder }
    Stop-Workers
    $mode = if ($Action -eq "off") { "off" } elseif ($Action -eq "disable-store") { "disable" } else { "enable" }
    Save-Configuration $mode $storeId
    Start-Workers
    Write-Host "Configuration updated. Review worker startup logs."
  }
} catch {
  Write-Host ($_.Exception.Message) -ForegroundColor Red
  Write-Host "If workers were stopped, use Start All after correcting the issue; the previous configuration backup is beside .env."
  exit 1
}

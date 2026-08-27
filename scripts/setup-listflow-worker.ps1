$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$logsDir = Join-Path $repoRoot "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$logPath = Join-Path $logsDir "setup-worker.log"
$transcriptStarted = $false

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Assert-Command($commandName, $friendlyName, $installHint) {
  $command = Get-Command $commandName -ErrorAction SilentlyContinue

  if (-not $command) {
    throw "$friendlyName was not found. $installHint Then run Setup ListFlow Worker again."
  }

  return $command
}

function Get-EnvValue($name) {
  $envPath = Join-Path $repoRoot ".env"

  foreach ($line in Get-Content -Path $envPath) {
    if ($line -match "^\s*#") {
      continue
    }

    if ($line -match "^\s*$([regex]::Escape($name))\s*=\s*(.*)\s*$") {
      $value = $Matches[1].Trim()

      if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      ) {
        $value = $value.Substring(1, $value.Length - 2)
      }

      return $value.Trim()
    }
  }

  return $null
}

function Assert-EnvValue($name) {
  $value = Get-EnvValue $name

  if ([string]::IsNullOrWhiteSpace($value)) {
    throw ".env is missing $name. Add $name to .env, then run Setup ListFlow Worker again."
  }

  if ($value -match "\[PASSWORD\]|\[YOUR-PASSWORD\]|change-this|your-") {
    throw ".env has a placeholder value for $name. Replace it with the real value, then run setup again."
  }
}

function Assert-AnyEnvValue($names) {
  foreach ($name in $names) {
    $value = Get-EnvValue $name
    if (-not [string]::IsNullOrWhiteSpace($value) -and $value -notmatch "\[PASSWORD\]|\[YOUR-PASSWORD\]|change-this|your-") {
      return
    }
  }

  throw ".env must contain a real value for one of: $($names -join ', ')."
}

function Invoke-CheckedCommand($label, $filePath, $arguments) {
  Write-Step $label
  & $filePath @arguments

  if ($LASTEXITCODE -ne 0) {
    throw "$label failed with exit code $LASTEXITCODE."
  }
}

try {
  Start-Transcript -Path $logPath -Append | Out-Null
  $transcriptStarted = $true

  Write-Host "ListFlow Worker setup"
  Write-Host "Repo: $repoRoot"
  Write-Host "Log:  $logPath"

  Write-Step "Checking Node.js and npm"
  Assert-Command "node.exe" "Node.js" "Install Node.js LTS from https://nodejs.org/." | Out-Null
  Assert-Command "npm.cmd" "npm" "Install Node.js LTS from https://nodejs.org/." | Out-Null
  Write-Host "Node: $(node --version)"
  Write-Host "npm:  $(npm.cmd --version)"

  Write-Step "Checking .env"
  $envPath = Join-Path $repoRoot ".env"
  $envExamplePath = Join-Path $repoRoot ".env.example"

  if (-not (Test-Path $envPath)) {
    Write-Host ".env was not found at $envPath" -ForegroundColor Red

    if (Test-Path $envExamplePath) {
      Write-Host "Opening .env.example in Notepad so you can see the required keys."
      Start-Process -FilePath "notepad.exe" -ArgumentList "`"$envExamplePath`""
    }

    throw "Create .env in the ListFlow folder before running setup. Do not put secrets in the setup file."
  }

  Assert-EnvValue "DATABASE_URL"
  Assert-AnyEnvValue @("LISTFLOW_DEPLOYED_DATABASE_URL", "MIGRATION_SOURCE_DATABASE_URL")
  Write-Host ".env found and the local workers have deployed database access."

  $ebayKeys = @(
    "EBAY_APP_ID",
    "EBAY_DEV_ID",
    "EBAY_CERT_ID",
    "EBAY_STORE1_TOKEN"
  )
  $missingEbayKeys = @()

  foreach ($key in $ebayKeys) {
    if ([string]::IsNullOrWhiteSpace((Get-EnvValue $key))) {
      $missingEbayKeys += $key
    }
  }

  if ($missingEbayKeys.Count -gt 0) {
    Write-Host "Warning: some eBay keys are missing: $($missingEbayKeys -join ', ')" -ForegroundColor Yellow
    Write-Host "Worker setup can continue, but eBay jobs may fail until these are added."
  }

  Invoke-CheckedCommand "Installing exact dependencies" "npm.cmd" @("ci")
  Invoke-CheckedCommand "Installing Chromium for worker scraping" "npm.cmd" @("run", "browser:install")
  Invoke-CheckedCommand "Generating Prisma client" "npm.cmd" @("exec", "prisma", "generate")
  Invoke-CheckedCommand "Checking the six-worker database configuration" "npm.cmd" @("run", "workers:local:check")
  Invoke-CheckedCommand "Creating Start All, Stop All, Update, and Repair shortcuts" "powershell.exe" @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $repoRoot "scripts\install-worker-shortcut.ps1"),
    "-CreateRepairShortcut"
  )
  Invoke-CheckedCommand "Creating per-store desktop shortcuts" "powershell.exe" @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $repoRoot "scripts\install-store-worker-shortcuts.ps1")
  )

  Write-Step "Setup complete"
  Write-Host "Daily use: double-click Start All 6 ListFlow Workers on the desktop."
  Write-Host "Graceful stop: double-click Stop All ListFlow Workers."
  Write-Host "Stable updates: double-click Update ListFlow Workers while this checkout is on master."
} catch {
  Write-Host ""
  Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Details were written to $logPath"
  exit 1
} finally {
  if ($transcriptStarted) {
    Stop-Transcript | Out-Null
  }
}

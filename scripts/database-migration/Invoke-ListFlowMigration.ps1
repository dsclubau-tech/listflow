[CmdletBinding()]
param(
  [ValidateSet("Preflight", "Apply", "Validate", "DropStage")]
  [string]$Mode = "Preflight",
  [string]$EnvFile = ".env",
  [string]$SourceUrlVariable = "MIGRATION_SOURCE_DATABASE_URL",
  [string]$TargetUrlVariable = "TARGET_DATABASE_URL",
  [string]$StageSchema = "",
  [switch]$RequireQuiescent,
  [switch]$ForceRollbackTest
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script:EnvFilePath = (Resolve-Path (Join-Path $script:RepoRoot $EnvFile)).Path
$script:WorkRoot = Join-Path $script:RepoRoot ".migration-work"
$script:ContainerWorkRoot = "/work/.migration-work"
$script:PostgresImage = "public.ecr.aws/supabase/postgres:17.6.1.143"

$script:DurableTables = @(
  "User",
  "Store",
  "DescriptionTemplate",
  "PolicyTemplate",
  "KeywordBlacklist",
  "SupplierSettings",
  "EbayImportStatsCache",
  "EbayListingAsin",
  "EbayRateLimitBucket",
  "Product",
  "Variant",
  "PriceHistory",
  "UploadLog",
  "UploadedImage",
  "PriceCheckJob",
  "EbayImportJob",
  "EbayResearchBatch",
  "EbayResearchJob",
  "EbayActionJob",
  "AppLog"
)

$script:NaturalKeys = [ordered]@{
  User = @("email")
  Store = @("loginId")
  EbayImportStatsCache = @("storeId")
  EbayListingAsin = @("storeId", "ebayItemId")
  EbayRateLimitBucket = @("storeId", "apiKind")
  SupplierSettings = @("storeId", "supplierName")
}

function Write-Utf8File([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-RelativeContainerPath([string]$HostPath) {
  $relative = $HostPath.Substring($script:RepoRoot.Length).TrimStart("\", "/")
  return "/work/" + $relative.Replace("\", "/")
}

function Get-EnvValues {
  $values = @{}
  foreach ($line in [System.IO.File]::ReadLines($script:EnvFilePath)) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      continue
    }

    $value = $Matches[2].Trim()
    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
       ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$Matches[1]] = $value
  }
  return $values
}

function Assert-SafeIdentifier([string]$Value, [string]$Label) {
  if ($Value -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw "$Label must contain only letters, numbers, and underscores."
  }
}

function Quote-Identifier([string]$Value) {
  return '"' + $Value.Replace('"', '""') + '"'
}

function ConvertTo-PostgresToolUrl([string]$Value) {
  $queryIndex = $Value.IndexOf('?')
  if ($queryIndex -lt 0) {
    return $Value
  }
  $baseUrl = $Value.Substring(0, $queryIndex)
  $rawQuery = $Value.Substring($queryIndex + 1)

  $unsupported = @(
    "connection_limit",
    "pgbouncer",
    "pool_timeout",
    "uselibpqcompat"
  )
  $query = @(
    $rawQuery.Split('&') | Where-Object {
      $key = ($_ -split '=', 2)[0]
      $unsupported -notcontains $key.ToLowerInvariant()
    }
  )

  if ($query.Count -eq 0) {
    return $baseUrl
  }
  return $baseUrl + '?' + ($query -join '&')
}

function Protect-DatabaseOutput([string]$Value) {
  $protected = $Value
  foreach ($name in @($SourceUrlVariable, $TargetUrlVariable)) {
    if ($script:EnvValues.ContainsKey($name) -and $script:EnvValues[$name]) {
      $protected = $protected.Replace(
        [string]$script:EnvValues[$name],
        "[REDACTED_DATABASE_URL]"
      )
    }
    if ($script:ToolUrls.ContainsKey($name) -and $script:ToolUrls[$name]) {
      $protected = $protected.Replace(
        [string]$script:ToolUrls[$name],
        "[REDACTED_DATABASE_URL]"
      )
    }
  }
  return $protected
}

function Invoke-DockerShell(
  [string]$Command,
  [string]$Label,
  [switch]$ReturnOutput
) {
  $mount = "type=bind,source=$($script:RepoRoot),target=/work"
  $environmentArguments = @()
  foreach ($name in @($SourceUrlVariable, $TargetUrlVariable) | Sort-Object -Unique) {
    if (-not $script:EnvValues.ContainsKey($name)) {
      throw "$name is missing from $EnvFile."
    }
    $toolUrl = ConvertTo-PostgresToolUrl ([string]$script:EnvValues[$name])
    $script:ToolUrls[$name] = $toolUrl
    [Environment]::SetEnvironmentVariable(
      $name,
      $toolUrl,
      [EnvironmentVariableTarget]::Process
    )
    $environmentArguments += @("--env", $name)
  }
  $arguments = @(
    "run",
    "--rm",
    $environmentArguments,
    "--mount", $mount,
    $script:PostgresImage,
    "sh", "-lc", $Command
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & docker @arguments 2>&1
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($LASTEXITCODE -ne 0) {
    $message = Protect-DatabaseOutput (
      (($output | Select-Object -Last 30) -join [Environment]::NewLine)
    )
    throw "$Label failed.`n$message"
  }

  if ($ReturnOutput) {
    return @($output)
  }
}

function Invoke-PsqlFile(
  [string]$UrlVariable,
  [string]$SqlPath,
  [string]$Label,
  [hashtable]$Variables = @{},
  [switch]$ReturnOutput
) {
  Assert-SafeIdentifier $UrlVariable "Database URL variable"
  $connectionReference = '$' + $UrlVariable
  $containerSqlPath = Get-RelativeContainerPath $SqlPath
  $variableArguments = @()
  foreach ($entry in $Variables.GetEnumerator() | Sort-Object Key) {
    Assert-SafeIdentifier ([string]$entry.Key) "psql variable"
    $safeValue = ([string]$entry.Value).Replace("'", "''")
    $variableArguments += "-v $($entry.Key)='$safeValue'"
  }
  $joinedVariables = $variableArguments -join " "
  $command = "psql `"$connectionReference`" -X -v ON_ERROR_STOP=1 $joinedVariables -f '$containerSqlPath'"
  return Invoke-DockerShell $command $Label -ReturnOutput:$ReturnOutput
}

function Invoke-PsqlFileToOutput(
  [string]$UrlVariable,
  [string]$SqlPath,
  [string]$OutputPath,
  [string]$Label
) {
  Assert-SafeIdentifier $UrlVariable "Database URL variable"
  $connectionReference = '$' + $UrlVariable
  $containerSqlPath = Get-RelativeContainerPath $SqlPath
  $containerOutputPath = Get-RelativeContainerPath $OutputPath
  $command = "psql `"$connectionReference`" -X -v ON_ERROR_STOP=1 -f '$containerSqlPath' > '$containerOutputPath'"
  Invoke-DockerShell $command $Label
}

function Assert-DockerReady {
  $null = & docker info --format '{{.ServerVersion}}' 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop's Linux engine is not running. Start Docker Desktop and retry."
  }
}

function Write-MetadataQuery([string]$OutputPath) {
  $tableList = ($script:DurableTables | ForEach-Object { "'" + $_ + "'" }) -join ", "
  $sql = @"
COPY (
  SELECT
    table_name,
    column_name,
    ordinal_position,
    udt_schema,
    udt_name,
    is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ($tableList)
  ORDER BY table_name, ordinal_position
) TO STDOUT WITH (FORMAT csv, HEADER true);
"@
  $queryPath = Join-Path $script:WorkRoot ("metadata-query-" + [Guid]::NewGuid().ToString("N") + ".sql")
  Write-Utf8File $queryPath $sql
  return $queryPath
}

function Get-DatabaseMetadata([string]$UrlVariable, [string]$Prefix) {
  $outputPath = Join-Path $script:WorkRoot "$Prefix-columns.csv"
  $queryPath = Write-MetadataQuery $outputPath
  Invoke-PsqlFileToOutput $UrlVariable $queryPath $outputPath "Read $Prefix schema metadata"
  return @(Import-Csv $outputPath)
}

function Get-PublicTableNames([string]$UrlVariable, [string]$Prefix) {
  $outputPath = Join-Path $script:WorkRoot "$Prefix-tables.csv"
  $sql = @"
COPY (
  SELECT table_name
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_type = 'BASE TABLE'
   ORDER BY table_name
) TO STDOUT WITH (FORMAT csv, HEADER true);
"@
  $queryPath = Join-Path $script:WorkRoot ("table-query-" + [Guid]::NewGuid().ToString("N") + ".sql")
  Write-Utf8File $queryPath $sql
  Invoke-PsqlFileToOutput $UrlVariable $queryPath $outputPath "Read $Prefix public table inventory"
  return @((Import-Csv $outputPath) | ForEach-Object { $_.table_name })
}

function Assert-TableInventory($SourceTables, $TargetTables) {
  $expectedSourceTables = @(
    $script:DurableTables + @("LoginAttempt", "WorkerHeartbeat", "JobLease", "_prisma_migrations")
  )
  $missingSource = @($expectedSourceTables | Where-Object { $SourceTables -cnotcontains $_ })
  $unexpectedSource = @($SourceTables | Where-Object { $expectedSourceTables -cnotcontains $_ })
  $missingTarget = @($expectedSourceTables | Where-Object { $TargetTables -cnotcontains $_ })
  $targetOnly = @($TargetTables | Where-Object { $SourceTables -cnotcontains $_ })

  if (
    $missingSource.Count -gt 0 -or
    $unexpectedSource.Count -gt 0 -or
    $missingTarget.Count -gt 0 -or
    $targetOnly.Count -ne 33
  ) {
    throw (
      "Public table inventory changed. Expected 24 source tables, all source tables " +
      "on target, and exactly 33 paid-target-only tables. Migration stopped."
    )
  }
}

function Assert-SchemaCompatibility($SourceColumns, $TargetColumns) {
  $problems = New-Object System.Collections.Generic.List[string]
  foreach ($table in $script:DurableTables) {
    $sourceTable = @($SourceColumns | Where-Object table_name -CEQ $table)
    $targetTable = @($TargetColumns | Where-Object table_name -CEQ $table)

    if ($sourceTable.Count -eq 0) {
      $problems.Add("Source table public.$table is missing.")
      continue
    }
    if ($targetTable.Count -eq 0) {
      $problems.Add("Target table public.$table is missing.")
      continue
    }

    foreach ($sourceColumn in $sourceTable) {
      $targetColumn = @($targetTable | Where-Object column_name -CEQ $sourceColumn.column_name)
      if ($targetColumn.Count -ne 1) {
        $problems.Add("Target column public.$table.$($sourceColumn.column_name) is missing.")
        continue
      }
      if (
        $targetColumn[0].udt_schema -cne $sourceColumn.udt_schema -or
        $targetColumn[0].udt_name -cne $sourceColumn.udt_name
      ) {
        $problems.Add(
          "Type mismatch for public.$table.$($sourceColumn.column_name): source " +
          "$($sourceColumn.udt_schema).$($sourceColumn.udt_name), target " +
          "$($targetColumn[0].udt_schema).$($targetColumn[0].udt_name)."
        )
      }
    }
  }

  if ($problems.Count -gt 0) {
    throw "Schema preflight failed:`n- $($problems -join "`n- ")"
  }
}

function Get-ActivitySummary([string]$UrlVariable) {
  $outputPath = Join-Path $script:WorkRoot "source-activity.csv"
  $sql = @"
COPY (
  SELECT 'PriceCheckJob' AS category, count(*)::bigint AS count
    FROM public."PriceCheckJob"
   WHERE status::text IN ('QUEUED', 'RUNNING', 'CANCELLING')
  UNION ALL
  SELECT 'EbayImportJob', count(*)::bigint
    FROM public."EbayImportJob"
   WHERE status::text IN ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING')
  UNION ALL
  SELECT 'EbayResearchJob', count(*)::bigint
    FROM public."EbayResearchJob"
   WHERE status::text IN ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED')
  UNION ALL
  SELECT 'EbayResearchBatch', count(*)::bigint
    FROM public."EbayResearchBatch"
   WHERE status::text IN ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED')
  UNION ALL
  SELECT 'EbayActionJob', count(*)::bigint
    FROM public."EbayActionJob"
   WHERE status::text IN ('QUEUED', 'RUNNING')
  UNION ALL
  SELECT 'JobLease', count(*)::bigint
    FROM public."JobLease"
   WHERE "expiresAt" > now()
  UNION ALL
  SELECT 'RecentWorkerHeartbeat', count(*)::bigint
    FROM public."WorkerHeartbeat"
   WHERE "lastSeenAt" > now() - interval '2 minutes'
) TO STDOUT WITH (FORMAT csv, HEADER true);
"@
  $queryPath = Join-Path $script:WorkRoot "source-activity-query.sql"
  Write-Utf8File $queryPath $sql
  Invoke-PsqlFileToOutput $UrlVariable $queryPath $outputPath "Read source activity"
  return @(Import-Csv $outputPath)
}

function Invoke-Preflight([switch]$MustBeQuiescent) {
  Assert-DockerReady
  New-Item -ItemType Directory -Force -Path $script:WorkRoot | Out-Null

  $envValues = Get-EnvValues
  if (-not $envValues.ContainsKey($SourceUrlVariable)) {
    throw "$SourceUrlVariable is missing from $EnvFile."
  }
  if (-not $envValues.ContainsKey($TargetUrlVariable)) {
    throw "$TargetUrlVariable is missing from $EnvFile."
  }
  if ($envValues[$SourceUrlVariable] -eq $envValues[$TargetUrlVariable]) {
    throw "Source and target database URLs are identical. Migration stopped."
  }

  $sourceColumns = Get-DatabaseMetadata $SourceUrlVariable "source"
  $targetColumns = Get-DatabaseMetadata $TargetUrlVariable "target"
  $sourceTables = Get-PublicTableNames $SourceUrlVariable "source"
  $targetTables = Get-PublicTableNames $TargetUrlVariable "target"
  Assert-TableInventory $sourceTables $targetTables
  Assert-SchemaCompatibility $sourceColumns $targetColumns

  $activity = Get-ActivitySummary $SourceUrlVariable
  $activeTotal = 0
  Write-Host "Source activity preflight:"
  foreach ($row in $activity) {
    $count = [int64]$row.count
    $activeTotal += $count
    Write-Host "  $($row.category): $count"
  }

  if ($MustBeQuiescent -and $activeTotal -gt 0) {
    throw "Source is not quiescent ($activeTotal active jobs, leases, or recent workers)."
  }

  $summary = [ordered]@{
    checkedAtUtc = [DateTime]::UtcNow.ToString("o")
    sourceColumnCount = $sourceColumns.Count
    targetColumnCount = $targetColumns.Count
    durableTableCount = $script:DurableTables.Count
    activeSourceRecords = $activeTotal
    requireQuiescent = [bool]$MustBeQuiescent
  }
  Write-Utf8File (Join-Path $script:WorkRoot "preflight-summary.json") ($summary | ConvertTo-Json)
  Write-Host "Schema compatibility passed for $($script:DurableTables.Count) durable tables."

  return [pscustomobject]@{
    SourceColumns = $sourceColumns
    TargetColumns = $targetColumns
    SourceTables = $sourceTables
    TargetTables = $targetTables
    ActiveTotal = $activeTotal
  }
}

function New-StageSchemaName {
  return "listflow_migration_" + (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmss")
}

function New-Stage(
  [string]$SchemaName,
  $SourceColumns
) {
  Assert-SafeIdentifier $SchemaName "Stage schema"
  $quotedSchema = Quote-Identifier $SchemaName

  $createStatements = $script:DurableTables | ForEach-Object {
    $quotedTable = Quote-Identifier $_
    "CREATE TABLE $quotedSchema.$quotedTable (LIKE public.$quotedTable INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY);"
  }
  $stageSql = "CREATE SCHEMA $quotedSchema;`n" + ($createStatements -join "`n") + "`n"
  $stageSqlPath = Join-Path $script:WorkRoot "create-stage.sql"
  Write-Utf8File $stageSqlPath $stageSql
  Invoke-PsqlFile $TargetUrlVariable $stageSqlPath "Create target staging schema"

  # Dump the source's public data once, then retain only exact durable-table
  # COPY blocks below. This avoids platform-specific command-line quote
  # handling for PostgreSQL's mixed-case table names and still guarantees that
  # excluded or unexpected tables can never enter the staging schema.
  $rawSourceDumpPath = Join-Path $script:WorkRoot "source-data.raw.sql"
  $sourceDumpPath = Join-Path $script:WorkRoot "source-data.sql"
  $containerDumpPath = Get-RelativeContainerPath $rawSourceDumpPath
  $connectionReference = '$' + $SourceUrlVariable
  $dumpCommand = @(
    "pg_dump `"$connectionReference`"",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--format=plain",
    "--schema=public",
    "--file='$containerDumpPath'"
  ) -join " "
  Invoke-DockerShell $dumpCommand "Dump durable source data"

  $durableSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach ($table in $script:DurableTables) {
    $null = $durableSet.Add($table)
  }
  $seenTables = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  $filteredLines = New-Object 'System.Collections.Generic.List[string]'
  $filteredLines.Add("SET client_encoding = 'UTF8';")
  $filteredLines.Add("SET standard_conforming_strings = on;")
  $filteredLines.Add("SET row_security = off;")
  $insideCopy = $false
  $includeCopy = $false

  foreach ($line in [System.IO.File]::ReadLines($rawSourceDumpPath)) {
    if (-not $insideCopy -and $line -match '^COPY public\."([^"]+)" \(.+\) FROM stdin;$') {
      $table = $Matches[1]
      $insideCopy = $true
      $includeCopy = $durableSet.Contains($table)
      if ($includeCopy) {
        if (-not $seenTables.Add($table)) {
          throw "Source dump contained duplicate COPY blocks for an expected table."
        }
        $filteredLines.Add($line.Replace('COPY public."', 'COPY ' + $quotedSchema + '."'))
      }
      continue
    }

    if ($insideCopy) {
      if ($includeCopy) {
        $filteredLines.Add($line)
      }
      if ($line -eq '\.') {
        $insideCopy = $false
        $includeCopy = $false
      }
    }
  }

  if ($insideCopy) {
    throw "Source dump ended inside a COPY block."
  }
  $missingTables = @($script:DurableTables | Where-Object { -not $seenTables.Contains($_) })
  if ($missingTables.Count -gt 0) {
    throw "Source dump did not contain COPY blocks for every durable table."
  }

  Write-Utf8File $sourceDumpPath (($filteredLines -join [Environment]::NewLine) + [Environment]::NewLine)
  Invoke-PsqlFile $TargetUrlVariable $sourceDumpPath "Load source data into staging schema"

  Write-Utf8File (Join-Path $script:WorkRoot "stage-schema.txt") $SchemaName
  Write-Host "Loaded durable source data into staging schema $SchemaName."
}

function Get-TableColumns($SourceColumns, [string]$TableName) {
  return @(
    $SourceColumns |
      Where-Object table_name -CEQ $TableName |
      Sort-Object { [int]$_.ordinal_position } |
      ForEach-Object { $_.column_name }
  )
}

function New-MergeSql([string]$SchemaName, $SourceColumns, $TargetTables) {
  Assert-SafeIdentifier $SchemaName "Stage schema"
  $quotedSchema = Quote-Identifier $SchemaName
  $lines = New-Object System.Collections.Generic.List[string]
  $untouchedTables = @(
    $TargetTables |
      Where-Object {
        $script:DurableTables -cnotcontains $_ -and
        $_ -cne "WorkerHeartbeat" -and
        $_ -cne "JobLease"
      } |
      Sort-Object
  )

  $lines.Add("\set QUIET 1")
  $lines.Add("BEGIN ISOLATION LEVEL REPEATABLE READ;")
  $lines.Add("SET LOCAL lock_timeout = '5s';")
  $lines.Add("SET LOCAL statement_timeout = '15min';")
  $lines.Add("SET LOCAL idle_in_transaction_session_timeout = '2min';")
  $lines.Add("SELECT pg_advisory_xact_lock(hashtextextended('listflow-paid-cutover-v1', 0));")
  $lockTargets = $script:DurableTables + @("WorkerHeartbeat", "JobLease") | ForEach-Object {
    "public." + (Quote-Identifier $_)
  }
  $lines.Add("LOCK TABLE " + ($lockTargets -join ", ") + " IN SHARE ROW EXCLUSIVE MODE;")
  $lines.Add(@"
CREATE OR REPLACE FUNCTION pg_temp.listflow_assert(condition boolean, message text)
RETURNS void
LANGUAGE plpgsql
AS `$function`$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION '%', message USING ERRCODE = 'P0001';
  END IF;
END
`$function`$;
"@)
  $lines.Add("CREATE TEMP TABLE _listflow_expected_counts (table_name text PRIMARY KEY, expected_count bigint NOT NULL) ON COMMIT DROP;")

  foreach ($table in $script:DurableTables) {
    $quotedTable = Quote-Identifier $table
    $lines.Add(@"
INSERT INTO _listflow_expected_counts (table_name, expected_count)
SELECT '$table',
       (SELECT count(*) FROM public.$quotedTable) +
       (SELECT count(*)
          FROM $quotedSchema.$quotedTable AS source
         WHERE NOT EXISTS (
           SELECT 1 FROM public.$quotedTable AS target WHERE target.id = source.id
         ));
"@)
  }

  $lines.Add("CREATE TEMP TABLE _listflow_untouched_snapshot (table_name text PRIMARY KEY, row_count bigint NOT NULL, fingerprint text NOT NULL) ON COMMIT DROP;")
  foreach ($table in $untouchedTables) {
    $quotedTable = Quote-Identifier $table
    $tableLiteral = $table.Replace("'", "''")
    $lines.Add(@"
INSERT INTO _listflow_untouched_snapshot (table_name, row_count, fingerprint)
SELECT '$tableLiteral',
       count(*)::bigint,
       COALESCE(md5(string_agg(row_hash, '' ORDER BY row_hash)), md5(''))
  FROM (
    SELECT md5(to_jsonb(target_row)::text) AS row_hash
      FROM public.$quotedTable AS target_row
  ) AS hashed_rows;
"@)
  }

  $lines.Add(@"
CREATE TEMP TABLE _listflow_user_extras ON COMMIT DROP AS
SELECT target.id,
       target."normalizedEmail",
       target."isActive",
       target."sessionVersion",
       target."lastLoginAt"
  FROM public."User" AS target
 WHERE EXISTS (
   SELECT 1 FROM $quotedSchema."User" AS source WHERE source.id = target.id
 );
"@)

  foreach ($entry in $script:NaturalKeys.GetEnumerator()) {
    $table = [string]$entry.Key
    $quotedTable = Quote-Identifier $table
    $guards = @($entry.Value | ForEach-Object { "source.$(Quote-Identifier $_) IS NOT NULL" })
    $matches = @($entry.Value | ForEach-Object {
      "source.$(Quote-Identifier $_) = target.$(Quote-Identifier $_)"
    })
    $predicate = (@($guards) + @($matches) + @("source.id <> target.id")) -join " AND "
    $lines.Add(@"
SELECT pg_temp.listflow_assert(
  NOT EXISTS (
    SELECT 1
      FROM $quotedSchema.$quotedTable AS source
      JOIN public.$quotedTable AS target ON $predicate
  ),
  'Natural-key collision detected in public.$table'
);
"@)
  }

  foreach ($table in $script:DurableTables) {
    $columns = Get-TableColumns $SourceColumns $table
    if ($columns.Count -eq 0 -or $columns -notcontains "id") {
      throw "Cannot build merge SQL for $table because its source columns are unavailable."
    }
    $updateColumns = @($columns | Where-Object { $_ -cne "id" })
    $quotedTable = Quote-Identifier $table
    $quotedColumns = @($columns | ForEach-Object { Quote-Identifier $_ })
    $selectColumns = @($columns | ForEach-Object { "source." + (Quote-Identifier $_) })
    $setClauses = @($updateColumns | ForEach-Object {
      $quoted = Quote-Identifier $_
      "$quoted = EXCLUDED.$quoted"
    })
    $targetComparison = @($updateColumns | ForEach-Object {
      "target." + (Quote-Identifier $_)
    })
    $excludedComparison = @($updateColumns | ForEach-Object {
      "EXCLUDED." + (Quote-Identifier $_)
    })

    $lines.Add("\echo Merging $table")
    $lines.Add(@"
INSERT INTO public.$quotedTable AS target ($($quotedColumns -join ', '))
SELECT $($selectColumns -join ', ')
  FROM $quotedSchema.$quotedTable AS source
ON CONFLICT (id) DO UPDATE
SET $($setClauses -join ",`n    ")
WHERE ROW($($targetComparison -join ', '))
      IS DISTINCT FROM
      ROW($($excludedComparison -join ', '));
"@)

    $sourceComparison = @($updateColumns | ForEach-Object {
      "source." + (Quote-Identifier $_)
    })
    $targetStageComparison = @($updateColumns | ForEach-Object {
      "target." + (Quote-Identifier $_)
    })
    $lines.Add(@"
SELECT pg_temp.listflow_assert(
  NOT EXISTS (
    SELECT 1
      FROM $quotedSchema.$quotedTable AS source
      LEFT JOIN public.$quotedTable AS target ON target.id = source.id
     WHERE target.id IS NULL
        OR ROW($($targetStageComparison -join ', '))
           IS DISTINCT FROM
           ROW($($sourceComparison -join ', '))
  ),
  'Post-merge validation failed for public.$table'
);
"@)
  }

  $lines.Add('DELETE FROM public."JobLease";')
  $lines.Add('DELETE FROM public."WorkerHeartbeat";')

  foreach ($entry in $script:NaturalKeys.GetEnumerator()) {
    $table = [string]$entry.Key
    $quotedTable = Quote-Identifier $table
    $quotedKeys = @($entry.Value | ForEach-Object { Quote-Identifier $_ })
    $nonnull = @($entry.Value | ForEach-Object { (Quote-Identifier $_) + " IS NOT NULL" })
    $lines.Add(@"
SELECT pg_temp.listflow_assert(
  NOT EXISTS (
    SELECT $($quotedKeys -join ', ')
      FROM public.$quotedTable
     WHERE $($nonnull -join ' AND ')
     GROUP BY $($quotedKeys -join ', ')
    HAVING count(*) > 1
  ),
  'Duplicate natural keys found in public.$table'
);
"@)
  }

  $lines.Add(@"
DO `$foreign_keys`$
DECLARE
  fk record;
  has_orphan boolean;
BEGIN
  FOR fk IN
    SELECT constraint_row.conname,
           constraint_row.conrelid::regclass::text AS child_table,
           constraint_row.confrelid::regclass::text AS parent_table,
           string_agg(
             format('child.%I = parent.%I', child_column.attname, parent_column.attname),
             ' AND ' ORDER BY child_key.ordinality
           ) AS join_predicate,
           string_agg(
             format('child.%I IS NOT NULL', child_column.attname),
             ' AND ' ORDER BY child_key.ordinality
           ) AS nonnull_predicate
      FROM pg_constraint AS constraint_row
      CROSS JOIN LATERAL unnest(constraint_row.conkey)
        WITH ORDINALITY AS child_key(attnum, ordinality)
      JOIN LATERAL unnest(constraint_row.confkey)
        WITH ORDINALITY AS parent_key(attnum, ordinality)
        ON parent_key.ordinality = child_key.ordinality
      JOIN pg_attribute AS child_column
        ON child_column.attrelid = constraint_row.conrelid
       AND child_column.attnum = child_key.attnum
      JOIN pg_attribute AS parent_column
        ON parent_column.attrelid = constraint_row.confrelid
       AND parent_column.attnum = parent_key.attnum
     WHERE constraint_row.contype = 'f'
       AND constraint_row.connamespace = 'public'::regnamespace
     GROUP BY constraint_row.oid,
              constraint_row.conname,
              constraint_row.conrelid,
              constraint_row.confrelid
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM %s AS child
          WHERE %s
            AND NOT EXISTS (
              SELECT 1 FROM %s AS parent WHERE %s
            )
       )',
      fk.child_table,
      fk.nonnull_predicate,
      fk.parent_table,
      fk.join_predicate
    ) INTO has_orphan;
    PERFORM pg_temp.listflow_assert(
      NOT has_orphan,
      format('Orphaned foreign key rows found for %s', fk.conname)
    );
  END LOOP;
END
`$foreign_keys`$;
"@)

  foreach ($table in $untouchedTables) {
    $quotedTable = Quote-Identifier $table
    $tableLiteral = $table.Replace("'", "''")
    $lines.Add(@"
WITH current_state AS (
  SELECT count(*)::bigint AS row_count,
         COALESCE(md5(string_agg(row_hash, '' ORDER BY row_hash)), md5('')) AS fingerprint
    FROM (
      SELECT md5(to_jsonb(target_row)::text) AS row_hash
        FROM public.$quotedTable AS target_row
    ) AS hashed_rows
)
SELECT pg_temp.listflow_assert(
  current_state.row_count = before_state.row_count
  AND current_state.fingerprint = before_state.fingerprint,
  'Untouched paid-target table changed: public.$tableLiteral'
)
FROM current_state
CROSS JOIN _listflow_untouched_snapshot AS before_state
WHERE before_state.table_name = '$tableLiteral';
"@)
  }

  $lines.Add(@"
DO `$validation`$
DECLARE
  expected record;
  actual_count bigint;
BEGIN
  FOR expected IN SELECT * FROM _listflow_expected_counts ORDER BY table_name LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', expected.table_name)
      INTO actual_count;
    PERFORM pg_temp.listflow_assert(
      actual_count = expected.expected_count,
      format(
        'Unexpected row count for public.%I: expected %s, found %s',
        expected.table_name,
        expected.expected_count,
        actual_count
      )
    );
  END LOOP;
END
`$validation`$;

SELECT pg_temp.listflow_assert(
  NOT EXISTS (
    SELECT 1
      FROM _listflow_user_extras AS before
      JOIN public."User" AS after ON after.id = before.id
     WHERE ROW(
       after."normalizedEmail",
       after."isActive",
       after."sessionVersion",
       after."lastLoginAt"
     ) IS DISTINCT FROM ROW(
       before."normalizedEmail",
       before."isActive",
       before."sessionVersion",
       before."lastLoginAt"
     )
  ),
  'Paid-target-only User fields changed during migration'
);

SELECT pg_temp.listflow_assert(
  NOT EXISTS (SELECT 1 FROM public."JobLease"),
  'JobLease cleanup failed'
);
SELECT pg_temp.listflow_assert(
  NOT EXISTS (SELECT 1 FROM public."WorkerHeartbeat"),
  'WorkerHeartbeat cleanup failed'
);

\if :force_failure
  \echo Forcing a failure to verify transaction rollback
  SELECT 1 / 0;
\endif

COMMIT;
\set QUIET 0
"@)

  foreach ($table in $script:DurableTables) {
    $lines.Add("ANALYZE public.$(Quote-Identifier $table);")
  }

  return $lines -join "`n"
}

function Write-ValidationReport([string]$SchemaName, $SourceColumns) {
  Assert-SafeIdentifier $SchemaName "Stage schema"
  $quotedSchema = Quote-Identifier $SchemaName
  $reportPath = Join-Path $script:WorkRoot "validation-report.csv"
  $unions = @()
  foreach ($table in $script:DurableTables) {
    $quotedTable = Quote-Identifier $table
    $unions += @"
SELECT '$table'::text AS table_name,
       (SELECT count(*) FROM $quotedSchema.$quotedTable)::bigint AS staged_rows,
       (SELECT count(*) FROM public.$quotedTable)::bigint AS target_rows,
       (SELECT count(*)
          FROM $quotedSchema.$quotedTable AS source
         WHERE EXISTS (
           SELECT 1 FROM public.$quotedTable AS target WHERE target.id = source.id
         ))::bigint AS staged_rows_present
"@
  }
  $query = ($unions -join "`nUNION ALL`n") + "`nORDER BY table_name"
  $sql = @"
COPY ($query) TO STDOUT WITH (FORMAT csv, HEADER true);
"@
  $sqlPath = Join-Path $script:WorkRoot "validation-report.sql"
  Write-Utf8File $sqlPath $sql
  Invoke-PsqlFileToOutput $TargetUrlVariable $sqlPath $reportPath "Generate validation report"
  $report = @(Import-Csv $reportPath)
  $missing = @($report | Where-Object {
    [int64]$_.staged_rows_present -ne [int64]$_.staged_rows
  })
  if ($missing.Count -gt 0) {
    throw "Validation report found staged rows missing from the target."
  }
  Write-Host "Validation passed for $($report.Count) durable tables."
}

function Remove-Stage([string]$SchemaName) {
  Assert-SafeIdentifier $SchemaName "Stage schema"
  if (-not $SchemaName.StartsWith("listflow_migration_")) {
    throw "Refusing to drop a schema that is not a ListFlow migration staging schema."
  }
  $sqlPath = Join-Path $script:WorkRoot "drop-stage.sql"
  Write-Utf8File $sqlPath ("DROP SCHEMA " + (Quote-Identifier $SchemaName) + " CASCADE;`n")
  Invoke-PsqlFile $TargetUrlVariable $sqlPath "Drop migration staging schema"
  Write-Host "Dropped staging schema $SchemaName."
}

New-Item -ItemType Directory -Force -Path $script:WorkRoot | Out-Null
Assert-SafeIdentifier $SourceUrlVariable "Source URL variable"
Assert-SafeIdentifier $TargetUrlVariable "Target URL variable"
$script:EnvValues = Get-EnvValues
$script:ToolUrls = @{}

switch ($Mode) {
  "Preflight" {
    $null = Invoke-Preflight -MustBeQuiescent:$RequireQuiescent
  }
  "Apply" {
    $preflight = Invoke-Preflight -MustBeQuiescent:$RequireQuiescent
    if (-not $StageSchema) {
      $StageSchema = New-StageSchemaName
    }
    New-Stage $StageSchema $preflight.SourceColumns
    $mergeSql = New-MergeSql $StageSchema $preflight.SourceColumns $preflight.TargetTables
    $mergeSqlPath = Join-Path $script:WorkRoot "merge.sql"
    Write-Utf8File $mergeSqlPath $mergeSql
    $forceFailureValue = if ($ForceRollbackTest) { "true" } else { "false" }
    $mergeOutput = Invoke-PsqlFile `
      -UrlVariable $TargetUrlVariable `
      -SqlPath $mergeSqlPath `
      -Label "Merge durable ListFlow data" `
      -Variables @{ force_failure = $forceFailureValue } `
      -ReturnOutput
    $mergeOutput | ForEach-Object { Write-Host $_ }
    Write-ValidationReport $StageSchema $preflight.SourceColumns
    Write-Host "Migration apply completed. Staging schema retained: $StageSchema"
  }
  "Validate" {
    if (-not $StageSchema) {
      $stageFile = Join-Path $script:WorkRoot "stage-schema.txt"
      if (-not (Test-Path $stageFile)) {
        throw "Provide -StageSchema or run Apply first."
      }
      $StageSchema = ([System.IO.File]::ReadAllText($stageFile)).Trim()
    }
    $preflight = Invoke-Preflight
    Write-ValidationReport $StageSchema $preflight.SourceColumns
  }
  "DropStage" {
    if (-not $StageSchema) {
      $stageFile = Join-Path $script:WorkRoot "stage-schema.txt"
      if (-not (Test-Path $stageFile)) {
        throw "Provide -StageSchema or run Apply first."
      }
      $StageSchema = ([System.IO.File]::ReadAllText($stageFile)).Trim()
    }
    Assert-DockerReady
    Remove-Stage $StageSchema
  }
}

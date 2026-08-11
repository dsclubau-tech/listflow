# ListFlow paid-database migration

This tooling merges the 20 durable ListFlow tables from the temporary Supabase
database into the existing paid Supabase database. It never restores the source
schema over the paid project.

## Safety rules

- `MIGRATION_SOURCE_DATABASE_URL` is always the read-only migration source.
- `TARGET_DATABASE_URL` is always the paid destination.
- `LoginAttempt`, `WorkerHeartbeat`, `JobLease`, Supabase Auth/Storage, and
  `_prisma_migrations` are not imported.
- Paid-target-only rows, columns, and tables are preserved.
- The apply step uses a transaction, an advisory lock, explicit columns,
  natural-key checks, row-count assertions, and post-merge equality checks.
- Generated dumps and SQL are stored under `.migration-work`, which is ignored
  by Git and may contain sensitive data.

## Commands

Run from the repository root in PowerShell:

```powershell
# Read-only schema and activity checks
powershell -ExecutionPolicy Bypass -File scripts/database-migration/Invoke-ListFlowMigration.ps1 -Mode Preflight

# Final cutover gate: also requires no active jobs, leases, or recent workers
powershell -ExecutionPolicy Bypass -File scripts/database-migration/Invoke-ListFlowMigration.ps1 -Mode Preflight -RequireQuiescent

# Load a new staging schema and merge transactionally
powershell -ExecutionPolicy Bypass -File scripts/database-migration/Invoke-ListFlowMigration.ps1 -Mode Apply -RequireQuiescent

# Recheck that every staged source row exists in the paid target
powershell -ExecutionPolicy Bypass -File scripts/database-migration/Invoke-ListFlowMigration.ps1 -Mode Validate

# Remove the retained staging schema only after monitoring passes
powershell -ExecutionPolicy Bypass -File scripts/database-migration/Invoke-ListFlowMigration.ps1 -Mode DropStage
```

Use `-ForceRollbackTest` with `-Mode Apply` only against an isolated rehearsal
database. It forces an error immediately before `COMMIT` so rollback can be
verified.

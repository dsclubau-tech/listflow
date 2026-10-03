# ListFlow workers on this PC

This installation uses the deployed Supabase database and the deployed ListFlow website. It runs two workers per configured store from `D:\ListFlow-Workers`. The development checkout remains `D:\listflow`.

## Install and start

1. Keep the other PC's workers stopped. Wait for their fresh heartbeats and active leases to expire.
2. Run the reviewed release builder in the clean development checkout: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-local-workers.ps1`.
3. Install the resulting ZIP: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-local-worker-release.ps1 -PackageZip <absolute ZIP path>`. This copies the private local `.env` into the worker folder; the ZIP contains no secrets.
4. Run `01 Setup.cmd`, then `02 Check Configuration.cmd` in `D:\ListFlow-Workers`.
5. Run `03 Start All Workers.cmd`. It reports success only when six fresh heartbeats are visible. The controller runs hidden and writes logs under `D:\ListFlow-Workers\logs`.

`04 Stop All Workers.cmd` requests graceful shutdown; an active job may keep a worker alive until its current work finishes. `05 Worker Status.cmd` shows process and database status. `06 Collect Diagnostics.cmd` writes a redacted report under `diagnostics`.

The package uses an installation-scoped worker ID. The three configured store logins are `store-1`, `aussiewalmartonline`, and `oz-metro`; the supervisor creates two replicas per store. The package enables `delivery-state` for all three stores and keeps normal production job selections unrestricted.

## Upgrade after active jobs

For a source-only replacement with the same file set or added files, first run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\complete-local-worker-upgrade.ps1 -Mode Verify -PackageZip <absolute ZIP path>` from the development checkout. The read-only check verifies the installed manifest and planned file changes.

Run the same command with `-Mode Run` to request graceful stop and wait for active jobs to finish. It then backs up changed source and the private configuration under the ignored diagnostics directory, verifies the new ZIP, copies its changed source into `D:\ListFlow-Workers`, retains the installed `.env`, dependencies, and logs, and starts the six workers after old heartbeats clear. Keep the command running or launch it as a hidden one-time helper with its output redirected to a private log. If any step fails, inspect that log and the backup before retrying; the script does not restart the older source automatically.
## Replacement and rollback

Retain the original ZIP, manifest, private `.env`, and logs. A new release is installed into an empty destination after the existing supervisor stops. Do not overwrite a running checkout. Preserve older logs before removing its runtime directory. If a new release fails, stop it gracefully and preserve its diagnostics; restart a prior known-good release only after its code and configuration are confirmed healthy. Never kill all Node processes, clear live leases, or delete another PC's files.

The database schema and product listings are not changed by package installation. The website and worker should use the same reviewed repair revision. Pushing GitHub alone does not install or start this PC's workers.
## Concurrent price checks

Each store retains its own pair of workers. Imports and bulk actions retain priority;
manual price-check jobs precede waiting automatic checks. Running jobs finish normally.
Different jobs may scrape the same product concurrently; a job ownership lease prevents
two workers from executing the same job. No store or selection-wide execution lock is used.

Amazon snapshot timestamps determine freshness. Results and marketplace writes use a short
application lease, with a fresh product/settings read before calculations. Older snapshots
remain diagnostic observations and complete their own checkpoints without replacing newer
results. Equal timestamps keep the accepted result. Technical attempts do not advance
verified observation freshness. A marketplace timeout with an uncertain outcome is retained
as a reconciliation operation and is not automatically replayed.

Upgrade all six workers together after graceful shutdown. Keep the installed environment,
instance identity, store assignments, and all-store delivery reuse. This release uses the
existing job-based scheduler and requires no database migration.

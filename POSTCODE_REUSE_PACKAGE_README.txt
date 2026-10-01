POSTCODE REUSE ROLLOUT PACKAGE

Extract this ZIP into the actual ListFlow worker folder. The layout must be:
  <worker folder>\.env
  <worker folder>\node_modules
  <worker folder>\postcode-reuse-rollout\01 Install.cmd

Run in order:
1. 01 Install.cmd
   Checks file hashes against the tested baseline or already-installed version.
   Refuses unexpected source differences before stopping workers or changing files.
   Gracefully stops active workers, backs up affected source files, installs this
   package's code, and leaves workers stopped. It preserves .env.
   If it reports an older/different source version, update the worker copy to
   the baseline revision in manifest.json before trying again.
2. 02 Preflight.cmd
   Reads the deployed database and existing .env. Reports actual store IDs,
   saved Amazon delivery postcodes, pacing, inherited overrides, and reuse status.
   Does not change supplier settings, products, or eBay listings.
3. 03 Audit.cmd
   Exports 30 distinct eligible observations for each configured store.
   Includes available regular/deal, held/active, and variant scenarios.
   Uses each store's saved scraper postcode and existing pauses.
   Runs paired baseline/delivery-state-only comparisons without eBay writes.
   Workers are stopped during comparison; previously running workers restart
   with their existing configuration afterward.
   Every report must have 30 matches, verified usable prices, and demonstrated
   session reuse. If products differ or all requests fail, activation stays blocked.
   If fewer than 30 representative products exist, the audit gives a clear error.
   Reports are saved in logs\postcode-reuse-rollout\<timestamp>-audit.
4. 04 Enable All Stores.cmd
   Rechecks deployed store postcodes, pacing, installed code, and audit reports.
   Refuses changed evidence or explicit exclusions of configured stores.
   Backs up .env, sets delivery-state all mode, and restarts all workers.
   Aussie Walmart and Oz Metro activate together. Future assigned stores inherit.
   Other optimization allowlists, listing locations, and worker pacing are preserved.

Rollback and recovery:
  05 Disable One Store.cmd: enter its login ID or database ID. Excludes that store.
  06 Enable One Store.cmd: restores that store's existing reuse eligibility.
  07 Disable All Stores.cmd: sets off mode while preserving other feature flags.
  All configuration changes use graceful worker stop/restart.
  Configuration backups sit beside .env; source backups are in
  logs\postcode-reuse-code-backup. They contain local configuration and must stay
  on the worker PC. This ZIP contains no credentials.

After enabling:
Check both workers for each store show:
  Postcode reuse mode: all
  Postcode reuse effective: ... deliveryStateEnabled: true
Observe two complete scheduled runs per store. Record job IDs, setup/reuse counts,
seconds per product, technical failures, and disabled-session reasons.
Healthy later products should reuse location state and skip setup/reload while
still verifying ASIN and delivery postcode. Every check gets fresh price/stock.

The package uses your existing configured worker-store list; it does not provision
workers for new stores. Reuse lasts for one store/browser/run, then is cleared.
The installer creates local source changes if the worker checkout uses Git.
The standard updater refuses dirty checkouts; retain the backups and coordinate
the next stable update rather than discarding changes blindly.

Developer commands to reproduce the package:
  powershell.exe -ExecutionPolicy Bypass -File scripts\package-postcode-reuse-rollout.ps1

Live comparisons and scheduled-run acceptance must be completed on the worker PC.
They have not been run by creating this ZIP.

# Price-check postcode reuse rollout

The all-store rollout supports RK Ecommerce, Aussie Walmart, Oz Metro, and future
stores once their workers are assigned. Activation is configured on the actual
worker PC. A web deployment alone does not update that PC's environment.

## Configuration

- `LISTFLOW_PRICE_CHECK_OPTIMIZATIONS` must contain `delivery-state`.
- `LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE=all` enables reuse for every identified
  store, independently of the general optimization allowlist.
- An absent mode or `allowlist` preserves the original general/narrow allowlists.
- `off` disables reuse globally.
- `LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS` excludes database store
  IDs in both all and allowlist modes.
- Other optimizations retain their existing general store allowlist.
- Invalid modes and missing store identity disable reuse with diagnostics.

Every run reads that store's saved Amazon scraper postcode once. Prices and stock
are fresh; the reused state contains delivery context only and expires with the
run. Listing postcodes/suburbs are independent.

## Portable package

See POSTCODE_REUSE_PACKAGE_README.txt. Build the package using:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/package-postcode-reuse-rollout.ps1
```

The ZIP is written to scratch/postcode-reuse-rollout.zip. Extract it into the
worker root so that postcode-reuse-rollout/ sits beside .env and node_modules.

Run 01 Install, 02 Preflight, 03 Audit, then 04 Enable All Stores.
The installer accepts only the tested baseline or the same installed source
hashes, backs up source files, and gracefully stops workers. It does not activate
all mode. Audit compares 30 representative products per configured store using
delivery-state alone and existing request pacing. It makes no eBay writes.
Activation requires complete matching evidence, usable verified prices, and a
demonstrated reuse event for every store. Existing exclusions are preserved;
configured stores with exclusions require explicit restoration first.

The current local package build is not proof that the remote worker rollout or
the three live comparisons have happened. Complete those steps on the worker PC.

## Manual configuration commands

Commands are dry-run unless --write is supplied:

```powershell
npx tsx scripts/configure-postcode-reuse.ts --env-file .env --mode all
npx tsx scripts/configure-postcode-reuse.ts --env-file .env --mode all --write
npx tsx scripts/configure-postcode-reuse.ts --env-file .env --store-id <database-ID> --mode disable --write
npx tsx scripts/configure-postcode-reuse.ts --env-file .env --store-id <database-ID> --mode enable --write
npx tsx scripts/configure-postcode-reuse.ts --env-file .env --mode off --write
```

Restart workers gracefully after configuration changes. Check inherited overrides:
dotenv keeps pre-existing process values, so editing .env is insufficient if the
supervisor inherits different rollout settings.

## Verification and acceptance record

Record only non-secret settings:

```text
Date/time, operator, worker checkout and revision:
Store login/database IDs and saved scraper postcodes:
Feature list, mode, general/narrow allowlists and exclusions:
Inherited overrides and effective settings for both workers per store:
Comparison input/report paths and result differences:
Two scheduled run IDs per store:
Setup/reuse/rejected/disabled event counts:
Setup time and weighted seconds per product:
Technical failure rate, availability/identity failures and retries:
Decision: accept / investigate / rollback
```

Enable Aussie Walmart and Oz Metro together only after verification. Observe two
complete scheduled runs for each store. Accept when healthy later products skip
repeated setup/reload, identity and postcode verification remain mandatory, and
measured setup overhead drops without an unexplained increase in technical
failures. No speed percentage is promised.

A per-store regression uses the exclusion command; a widespread regression uses
off mode. Preserve other flags and gracefully restart. Configuration rollback
affects future checks; review any confirmed incorrect marketplace update directly.

Historical initial baseline: c31f47dd73e0de53aa56f2a1fbca8585aabb3667.
The original experiment started with timing and all optimizations disabled.
Remote baseline evidence and rollout outcomes must be recorded by the operator.

# eBay variation inventory operations

This release is prepared locally. It requires a separately authorized coordinated rollout. It makes no database migration or historical SKU backfill.

## Marketplace targeting

The shared writer obtains a fresh authenticated GetItem snapshot for each prepared operation or reconciliation. The actual Variations structure determines variation addressing, including a listing with one remaining variation. Exact eBay SKUs are matched to local variants; case and value are preserved and XML escaped. Missing or duplicate mappings, changed structure, unexpected currency and ended listings block the affected product.

Each inventory request contains at most four entries. Each variation has its own price and optional available quantity. Fee/profit/rounding changes omit quantity; quantity-only changes omit price. General listing revisions omit item-level price and quantity and checkpoint separately before inventory updates.

A whole-listing hold includes all verified live remote variations. Manual resume uses matched intended targets at quantity 1. Automatic restoration remains subject to the existing recovery safeguards and permits only one verified remote target; several targets without individual evidence stay held for review. This release does not add Amazon checking per variation.

## Persisted payload version 1

This section describes the previous release. New operations use version 2, documented below; version-1 checkpoints remain readable and are reconciled before upgrade.

ListingOperation.preparedPayload is an immutable plan with kind "ebay-inventory" and version 1. It contains store/product/item identity, original local context, inventory tracking mode, exact remote SKU structure, intended per-target values, original remote values and optional listing-level step.

Target states are PENDING, CONFIRMED, REJECTED and UNCERTAIN. An applied flag checkpoints local acceptance separately from marketplace confirmation. The listing step also has an applied flag. COMPLETED is recorded only after all remote confirmations and local application checkpoints succeed.

Before each marketplace write the targets are saved UNCERTAIN. GetItem readback confirms requested values; generic acknowledgement alone does not confirm each variation. Readback mismatch after a sale or seller edit remains uncertain and does not reset stock. Restart reconciles uncertain targets before any possible write. Confirmed targets are never replayed or rolled back; rejected targets retain their prior accepted local values. Only explicitly retryable system rejections can be resubmitted after fresh revalidation.

BulkEditJobItem.payload uses inventoryV1.operations plus inventoryVersion and inventoryRequestKey after preparation. It deliberately omits the old top-level operations key so older bulk workers reject the new payload before writing. Unsupported payload versions must not execute. Legacy payloads with a snapshot use that snapshot to reconstruct the original requested values and reconcile read-only. A mismatch remains pending verification; it is not blindly resent.

The existing store write lane, product/result leases, worker ownership and cancellation checks remain in force. New conflicting inventory operations are blocked while an earlier plan is unresolved. Network requests occur outside database transactions.

## Progress and retry behavior

Products, rather than variations, determine job totals. Partial confirmation details identify each exact SKU. Uncertain outcomes display "Update result needs verification." Retry reconciles first and preserves confirmed steps. Ended listings and permanent mapping failures are excluded from automatic retries.

For the incident checkpoint of 411 processed / 405 successful / 6 failed, only the five eligible failures are selected. The ended listing remains failed; the 405 successful products are preserved. If all five validated retries succeed, totals become 411 processed / 410 successful / 1 failed. These are test expectations, not a statement that production retries have run.

Independent price-check errors, hold reasons and pending reviews are not cleared by unrelated successful listing edits.

## Coordinated release procedure

1. Preserve the previous application release, all unfinished job checkpoints and all ListingOperation/BulkEditJobItem records.
2. Gracefully stop all affected workers and wait for marketplace writes to finish. Do not reset completed IDs or uncertainty records.
3. Update web and all six workers together; no schema migration is required.
4. Verify all six release revisions and fresh heartbeats advertise variation-inventory-v1 before accepting new inventory jobs. A mixed old/new worker fleet is unsupported.
5. Read current eBay identities and review intended values for the five failed products. Do not infer mappings from parent ASIN or price.
6. Retry only eligible failures. Resolve or reconcile any prior uncertain operation first.
7. Verify actual per-SKU marketplace prices and quantities, all local checkpoints and final product counts before declaring the incident resolved.

## Rollback

Stop the new workers gracefully. Preserve all operation JSON, partial confirmations, uncertain states and local applied flags. Restore the previous application package only with inventory-writing jobs disabled or quarantined. Old workers must not process new versioned items or replay legacy-looking partially executed jobs. Leave all operation records intact for the new reconciler or explicit review; rollback must not run compensating marketplace writes.

## Local validation report — 6 October 2026

**Status: ready for local review; not deployed.** No production retry, listing write, stock restoration, worker restart, push or schema change was performed.

### Regression evidence

- The two missing-SKU XML cases failed before the XML correction.
- An isolated mocked harness loaded the original worker source from commit 56ac67be7b12a428843560b8fe3920e705fe0d1a. It reproduced a Baboni request containing only price 50 instead of the separate prices 50, 70 and 90.
- The same original-source harness reproduced local rollback to 50 after a simulated accepted remote price of 48.89. Current behavioral tests instead preserve confirmed targets and reconcile uncertain results without blind replay.
- An unsupported-payload regression failed before the explicit version guard and passes with the guard.
- These reproductions use synthetic listings and mocked marketplace boundaries. They do not establish current production listing values.

### Acceptance results

| Gate | Result |
| --- | --- |
| Full unit suite | 1,026 passed; 0 failed |
| Full browser suite | 112 passed; 10 live-credential tests skipped |
| Bulk-edit browser cases with strict request/runtime guards | 28 passed at desktop and mobile widths |
| TypeScript | Passed |
| Normal lint | Passed; no warnings |
| Production build | Passed |
| Complete diff review and git diff --check | Passed |

The initial sandbox build could not read an existing archived diagnostics folder. The normal production build passed after granting local filesystem access. Its remaining warning is the existing broad dynamic file pattern in lib/rotating-worker-log.ts; that file was not changed.

Coverage includes exact and XML-sensitive SKUs, one remaining variation, independent variation prices, quantity-only and fee-only edits, four-entry chunks, partial rejection, timeout/readback, local-save failures, cancellation, changed context, duplicate progress/retry requests, ended listings, legacy reconciliation, single/bulk approvals, automatic repricing and recovery safeguards. The incident checkpoint test preserves 405 successes, selects five eligible failures and produces 410 successes / 1 ended failure only after their simulated successful completion.

### Changed files

- Shared inventory planning and execution: lib/ebay-inventory.ts, lib/ebay-inventory-writer.ts, lib/ebay-bulk-inventory.ts, lib/ebay-inventory-job-results.ts.
- Marketplace and application integration: lib/ebay-xml.ts, lib/ebay.ts, lib/ebay-action-jobs.ts, lib/price-checker.ts, lib/price-check-result-application.ts, lib/product-bulk-edit.ts, lib/stock-replenishment.ts.
- Routes: app/api/price-check/apply/route.ts, app/api/price-check/bulk-apply/route.ts, app/api/products/bulk-edit/route.ts, app/api/products/bulk-edit/jobs/[id]/retry/route.ts.
- Worker compatibility: lib/worker-heartbeat.ts, scripts/listflow-worker.ts.
- Progress interface: components/BulkEditModal.tsx, components/BulkEditProgressCard.tsx, hooks/useBulkEditJob.ts.
- Tests: lib/ebay-inventory.test.ts, lib/ebay-inventory-job-results.test.ts, lib/ebay-variation-regression.test.ts, lib/amazon-delivery-cooldown.test.ts, lib/amazon-shipping-integration.test.ts, lib/ebay-action-cancellation.test.ts, lib/product-bulk-edit-durability.test.ts, tests/e2e/bulk-edit-lifecycle.spec.ts.
- Release and validation documentation: docs/ebay-variation-inventory-release.md.

### Remaining limits

There are no unresolved local validation failures. Real listing mappings and marketplace values still require review during an authorized rollout. Ended listings need separate handling. Several distinct variations cannot recover automatically from one product-level Amazon observation. Uncertain readback mismatches remain pending verification or review, including differences caused by sales; they are not automatically reset. Independent Amazon checking, SKU renaming, variation creation/deletion and automatic remapping remain outside this change.

## Live preflight parser correction

A read-only GetItem preflight for De’Longhi exposed the parser’s default 1,000-entity limit on a long, ordinarily escaped listing description. No marketplace update was made. Two new regressions failed before the correction and now pass. Inventory parsing rejects document-defined entities and responses larger than 8 MiB before parsing, while scaling predefined-reference limits to the bounded response length. Exact SKU decoding and listing-step comparisons remain unchanged.

After this correction: 1,028 unit tests and 112 mocked browser tests passed (10 credential-dependent tests skipped). TypeScript, normal lint, production build and diff checks passed. The pre-existing worker-log build warning remains.


## Version 2: parent collisions and deferred prices — 7 October 2026

This implementation is local. No deployment, live repair, production retry, stock restoration or database migration was performed. The existing De’Longhi listing is not declared resolved.

### Identity, authorization and durable execution

The planner rejects an exact parent/variation SKU collision, including a sole variation, using PARENT_VARIATION_SKU_COLLISION. Fresh structure reads also check the parent label immediately before listing-level and inventory writes. Automatic parent-label filling cannot copy a variation SKU onto an existing variation listing. Codes 21916735 and 21916736 retain their distinct short messages and common long message in structured diagnostics.

Inventory plans retain original local and remote values, authorization source (explicit edit, price approval or automatic policy), history IDs, supplier settings, tracking preference, committed evidence, hold generation and per-target checkpoints. Version 2 adds DEFERRED as a JSON target state, stored through the existing non-success database stage. A different requested price at zero variation stock is deferred unless an authorized positive quantity is already included. A matching remote price is a verified no-op. Price-only requests never add stock.

Authorized deferred requests remain unapplied until confirmed. New explicitly represented authorized targets can supersede an older deferred intent; the older JSON intent is retained with supersededBy. Supersession does not claim pricing success. Uncertain operations cannot be superseded or blindly replayed. Object comparisons normalize JSON key order so PostgreSQL JSONB ordering cannot manufacture context changes.

New bulk-item payloads use inventoryV2.operations and inventoryVersion 2 at creation. New jobs require a heartbeat advertising variation-inventory-v2. Version-1 plans reconcile first and upgrade before new writes; unknown versions are rejected. Older workers reject the new prepared payloads. This protection does not make a mixed fleet supported.

### Restoration and settlement

Recovery accounts for every unapplied history. Unapproved reviews, unexplained failures, changed inputs, changed evidence and uncertain writes remain blockers. A current authorized deferred price can join an otherwise eligible restoration: each exact ItemID/SKU entry includes its own StartPrice and Quantity 1. Current remote price/stock must match the source context or already match the complete desired result. Changed seller values require review.

Identity, eligible offer, accepted Amazon cost, verified stock threshold, fresh shipping, hold-origin and pending-review checks remain mandatory. Manual holds require manual resume; unknown-origin and review-required holds retain review requirements. Multiple variations without sufficient individual evidence cannot recover automatically. No independent per-variation Amazon checker or timed waiting period was added.

Readback must confirm both fields. Price-only or quantity-only application remains unresolved. Confirmed inventory checkpoints survive local failures, cancellation, restart and lost ownership. No compensating writes are issued. The restoration remains in RECONCILIATION until linked price histories, deferred source operations and any source bulk-item accounting settle. Each product is counted once; confirmed source counters settle under locks without replaying successful products. Changing or withdrawing approval during a write prevents a false resumed result.

Existing progress and approval screens distinguish parent repair, awaiting restoration and needs-verification states. Approval accepted for later application is not displayed as an applied price. Action Center derives unresolved approved deferrals from stored operations on reopening; no new polling loop was added. Independent Amazon errors and hold reasons remain separate.

### Restricted De’Longhi repair procedure

The maintenance script is scripts/repair-delonghi-parent-sku.ts. Its default mode reads only and saves a redacted preview to scratch/delonghi-parent-sku-repair-preview.json. It is fixed to seed-store-1, product cmuo5d08u03sk5gvjwn9ldb7x, ItemID 304997589004 and SKU B07G5B97VD. It requires explicit ItemID tracking, one matching variation, active AUD listing status, zero available quantity and unchanged local identity.

Read-only command:

    node --conditions=react-server --import tsx scripts/repair-delonghi-parent-sku.ts

Only --help was run during this implementation. A separately authorized operator must review the dry-run evidence and exact XML before using the script's explicit apply options. The write removes only Item.SKU through DeletedField. It sends no replacement label, price, quantity or variation changes.

Apply acquires the normal listing-write lease, rejects unresolved operations, checkpoints before sending and verifies that the parent is absent while variation SKU, specifics, price, quantity, tracking and listing identity remain unchanged. Every existing potentially sent checkpoint, including PREPARED, is reconciled without resending. Unexpected state stops for review.

Repair confirmation means identity repair only. It does not retry A$239.99, clear the manual hold or saved Amazon failure, restore stock or rewrite historical bulk-job success.

### Coordinated rollout and rollback

Keep the prior release and unresolved checkpoints. Gracefully stop web/worker writes, update web and all six workers together, and verify the same release plus fresh variation-inventory-v2 heartbeats. Perform the separately authorized and reviewed repair only afterward. Any later price/stock action requires current intended values and current eligibility; never replay an old price solely because the label was repaired.

Rollback preserves version-2 records, uncertainty and partial confirmations. Older workers must remain unable to execute these operations. No automatic historical backfill is included.

### Validation evidence and limits

Five new regression cases failed against the unchanged implementation before the core fix (scratch/inventory-v2-before.log). Focused tests cover collisions at zero/positive stock, distinct error details, deferral/no-op, one-field remote application, fresh pre-write changes, changed authorization/context, JSONB ordering, actual single/bulk approval routes, worker restoration, restart, counters and narrow repair behavior. Browser tests mount the actual progress and Action Center components at desktop/mobile widths and reject unexpected requests/runtime errors.

Sandbox configuration and credentials were unavailable. All marketplace and database boundaries in behavioral tests were mocked; no live listing was substituted for sandbox validation. The repair --help check passed.

Final local gates:

| Gate | Result |
|---|---|
| New regression baseline | Five cases failed before implementation |
| Full unit suite | 1,048 passed, zero failed on final rerun |
| Full browser suite | 116 passed; 10 credential-dependent cases skipped |
| TypeScript | Passed after the production build |
| Normal lint | Passed |
| Production build | Passed; existing rotating-worker-log broad-pattern warning remains |
| Full change review and git diff --check | Passed |
| Isolated marketplace sandbox | Unavailable; no live substitute used |

The preceding unit run had one transient EBUSY cleanup failure in the unchanged postcode-reuse-package test's Windows temporary folder; all 1,048 tests passed on rerun without changing that test. The first restricted build could not read an existing diagnostics directory; the normal build passed with local filesystem access. These environmental results are separate from the new behavior.

The local implementation is ready for review with the sandbox limitation above. Production remains on its existing release. De’Longhi still needs its separately authorized identity repair and independently eligible price/stock operation; its manual hold and Amazon failure were not cleared.

Changed files:

- Inventory: lib/ebay-inventory.ts, lib/ebay-inventory-writer.ts, lib/ebay-deferred-pricing.ts, lib/ebay-deferred-settlement.ts, lib/ebay-bulk-inventory.ts, lib/ebay-inventory-job-results.ts.
- Pricing/recovery: lib/price-checker.ts, lib/price-check-recovery-evidence.ts, lib/price-check-auto-resume.ts, lib/ebay-action-jobs.ts.
- API: app/api/price-check/apply/route.ts, app/api/price-check/bulk-apply/route.ts, app/api/products/bulk-edit/route.ts.
- Interface: lib/action-center.ts, components/ActionCenterClient.tsx, components/DraftsTable.tsx, components/BulkEditModal.tsx, components/BulkEditProgressCard.tsx.
- Compatibility: lib/worker-heartbeat.ts, scripts/listflow-worker.ts.
- Restricted repair: lib/ebay-parent-sku-repair.ts, scripts/repair-delonghi-parent-sku.ts.
- Tests: lib/ebay-inventory-v2.test.ts, lib/ebay-parent-sku-repair.test.ts, lib/ebay-inventory-job-results.test.ts, lib/amazon-shipping-integration.test.ts, lib/amazon-delivery-cooldown.test.ts, tests/e2e/bulk-edit-lifecycle.spec.ts, tests/e2e/action-center-delivery-wait.spec.ts.
- Runbook: docs/ebay-variation-inventory-release.md.

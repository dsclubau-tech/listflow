# eBay variation inventory operations

This release is prepared locally. It requires a separately authorized coordinated rollout. It makes no database migration or historical SKU backfill.

## Marketplace targeting

The shared writer obtains a fresh authenticated GetItem snapshot for each prepared operation or reconciliation. The actual Variations structure determines variation addressing, including a listing with one remaining variation. Exact eBay SKUs are matched to local variants; case and value are preserved and XML escaped. Missing or duplicate mappings, changed structure, unexpected currency and ended listings block the affected product.

Each inventory request contains at most four entries. Each variation has its own price and optional available quantity. Fee/profit/rounding changes omit quantity; quantity-only changes omit price. General listing revisions omit item-level price and quantity and checkpoint separately before inventory updates.

A whole-listing hold includes all verified live remote variations. Manual resume uses matched intended targets at quantity 1. Automatic restoration remains subject to the existing recovery safeguards and permits only one verified remote target; several targets without individual evidence stay held for review. This release does not add Amazon checking per variation.

## Persisted payload version 1

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

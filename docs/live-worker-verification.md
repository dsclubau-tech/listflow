# Live worker verification

The private incident reports and raw comparisons are archived under the ignored `diagnostics/incident-evidence-2026-10-02` and `scratch/local-live` directories. Credentials, cookies, and full Amazon HTML do not belong in Git.

## Evidence already obtained

- Local RK manual check: two products, two verified observations, zero technical failures.
- RK five-product comparison: reuse off took 68.791 seconds; reuse on took 48.160 seconds. All five normalized results matched. Setup/reload counts fell from five to one. This is one sequential local pair, not a guaranteed performance median.
- Same three-product read-only probe: all three stores verified `2217` locally. Aussie Walmart showed verified Buy Box unavailability; RK showed verified out-of-stock; Oz Metro returned regular A$69.99 and shipping A$0. The former worker PC returned `Server Busy` before setup on each.
- The Prisma advisory lock regression passed against the actual Supabase database in a read-only transaction.

## Release checks

Run `npm run test:delivery-repair`, worker configuration and routing tests, the opted-in read-only Prisma check, TypeScript, changed-file lint, production build, and browser tests for waiting messages. Inspect the final staged diff and scan for secrets before committing. Recheck that no other PC has a fresh heartbeat or unexpired job lease before packaged worker startup.

Run the packaged preflight and status controls. Confirm six fresh heartbeats, one revision, two assigned workers per store, `delivery-state` effective for each store, exact saved postcodes, normal job progress, and no technical-error holds. An unverified technical observation must defer unfinished work. Confirm the first complete scheduled run for each store before declaring the replacement healthy.

Live browser tests that save a manual check must be explicitly opted in and use selected products only; never retry those mutations automatically. The read-only diagnostic probe does not save products or call eBay. Keep error and timeout samples separately from real marketplace writes.

## Concurrent check release

Run `npm test`, `npx tsc --noEmit`, changed-file ESLint, `npm run build`, and the mocked browser checks in `tests/e2e/concurrent-price-checks.spec.ts`. These checks cover manual queue priority, overlapping jobs, per-job ownership, newer observation ordering, marketplace serialization, cancellation, and store/session isolation.

The optional database regression is `node --import tsx --test scripts/test-concurrent-price-check-database.ts` with `LISTFLOW_RUN_CONCURRENT_DB_TEST=1` and the explicit installed worker environment file. It reads the three stores, inserts temporary leases and observations inside one transaction, and intentionally rolls everything back. It does not update products or call eBay.

For live rollout, preserve existing jobs and gracefully finish old workers before installing the committed archive. Use at most a small selected sample per store to verify two job claims and independent sessions; do not enqueue full catalog scans for verification. Record the installed revision, six fresh heartbeats, observation times, accepted/stale decisions, checkpoints, and marketplace outcomes in the ignored evidence archive.


Pre-release verification on October 3 obtained six fresh verified Amazon snapshots: two per configured store. Every snapshot verified the requested ASIN and saved delivery postcode; each store's second product reused its own seeded delivery state. The sample made no product or marketplace writes. The real database regression also passed for all three stores and rolled back its temporary records. Controlled browser tests displayed concurrent jobs with usable controls at desktop and mobile sizes. Raw evidence remains in ignored local storage.

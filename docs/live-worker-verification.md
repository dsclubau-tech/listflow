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
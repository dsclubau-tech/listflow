# Amazon shipping limit: local implementation and coordinated release

## Behavior

The Amazon AU Maximum Shipping Days setting uses the latest arrival date, counted in calendar days in Australia/Sydney. A limit of 25 allows day 25 and rejects day 26. A verified dispatch delay beyond the limit also fails; short dispatch alone does not prove arrival.

Price and shipping remain separate. Regular/Deal preferences and tracking fallback are unchanged. The scraper verifies saved variants even when a price is already displayed. Only the accepted new offer's primary delivery promise is used; advertised faster options and unrelated offers do not establish eligibility.

Verified slow shipping queues an eBay quantity-zero hold promptly, independently of the price-check-failure toggle. Status changes only after eBay confirms the write. Unknown evidence gets one fresh-context retry within the existing budget, records a warning, and creates no new shipping hold. Manual/review holds and other failures remain protected.

Automatic recovery requires current committed identity, price, stock, shipping and repricing evidence. Shipping evidence expires after 15 minutes. Recovery is queued per completed held product, then revalidated by the action worker. Restoration quantity remains 1. A stale action waits for another check.

Uploads use the shared server path for direct, editor, bulk and worker uploads. Fresh matching evidence may be reused; newer failed/unknown evidence forces a check. Confirmed slow shipping stays in Drafts and cannot be overridden. Unknown delivery stays in Drafts and offers Retry check, Upload anyway and Cancel. The authenticated challenge refers to one product and one attempt. Server metadata binds it to store, ASIN, requested/selected mode, postcode and limit. Retried work retains that attempt's approval; a new attempt does not. Context changes and technical/identity/price failures block the write.

## Database change

Migration: prisma/migrations/20261004130000_enforce_amazon_shipping/migration.sql

- Nullable versioned AmazonPriceObservation.shippingEvidence JSONB.
- Additive ProductHoldOrigin.AMAZON_SHIPPING_DELAY enum value.
- No inferred backfill. Older observations mean unknown.

The additive SQL was validated with existing synthetic rows in disposable PostgreSQL (PGlite). This does not substitute for checking the target migration history and taking the normal backup before an authorized release. No production migration has been applied for this implementation.

## Validation

Run npm test, npm run lint, npx tsc --noEmit and npm run build. Run TypeScript after the build, rather than concurrently with Prisma generation.

Browser checks:

    npx playwright test tests/e2e/amazon-shipping-confirmation.spec.ts tests/e2e/inline-edit-category.spec.ts tests/e2e/store-switcher.spec.ts tests/e2e/favorite-research.spec.ts

Amazon/eBay calls in the shipping regression tests are mocked or fulfilled with offline browser fixtures. Unexpected browser requests fail the UI tests. Do not run live upload, listing or migration commands to verify this change.

## Later authorized rollout

1. Preserve the prior release and database backup; record web/worker release IDs.
2. Gracefully cancel/checkpoint affected jobs and stop all six local workers using the existing stop-and-resume procedure. Preserve unfinished product IDs.
3. Review migration status and apply additive migrations with the existing deployment process (prisma migrate deploy), against the explicitly confirmed target database.
4. Install the same reviewed application release for web and all six workers, regenerate Prisma, and build. Do not run old workers while the new web release creates shipping jobs.
5. Start workers and confirm each heartbeat reports the expected release. Resume unfinished checks without replaying completed work.
6. Run fresh shipping checks. Confirm committed evidence, hold/recovery jobs, eBay-confirmed quantity and upload prompts before claiming listings are protected. Existing listings are protected after checks, not just after installation.

Changing the limit affects subsequent checks/action validation; it does not directly restore stock. The local implementation does not undo an order or remove the gap between an Amazon change and the next check.

## Rollback

Prior application release: b58f06cc24d2b37a4e51791dbb9e512fbd5e0885.

A local rollback review package under scratch/shipping-limit-rollback.zip preserves replaced tracked files and the added-file manifest; it contains no environment files or credentials. Prefer restoring the complete prior application release from Git/release artifacts and coordinating web plus all six workers. Gracefully stop/checkpoint jobs first. Review pending shipping hold/approval jobs before old workers are allowed to execute them, since the prior release does not understand those decisions.

Leave the nullable column and added enum value in place. Do not drop shipping observations or rewrite hold origins during application rollback. Old code does not enforce Maximum Shipping Days. Rollback therefore removes this protection and requires a separate operational decision about pending jobs and held listings.

## Completed local validation (4 October 2026)

- Full unit suite: 921 passed, zero failures.
- Mocked browser suite: 38 passed (shipping confirmation, editor, store switching and favorites).
- TypeScript: passed after the final build regenerated Prisma.
- Normal lint: zero errors and zero warnings.
- Production build: passed.
- Disposable PostgreSQL migration and tracked/new-file whitespace checks: passed.
- No production migration, GitHub push, deployment or worker restart.

Reviewed changed files:

- app/api/products/[id]/route.ts
- app/api/upload/route.ts
- components/DraftsTable.tsx
- components/InlineEditForm.tsx
- components/settings/SupplierSettingsTab.tsx
- lib/amazon-deal-price-scraper.test.ts
- lib/amazon-delivery-cooldown.test.ts
- lib/amazon-scraper.ts
- lib/current-hold-reason.ts
- lib/ebay-action-jobs.ts
- lib/ebay-upload.ts
- lib/price-check-auto-hold.ts
- lib/price-check-auto-resume.ts
- lib/price-check-failures.test.ts
- lib/price-check-failures.ts
- lib/price-check-recovery-evidence.test.ts
- lib/price-check-recovery-evidence.ts
- lib/price-checker.ts
- lib/products-page-data.ts
- prisma/schema.prisma
- tests/e2e/inline-edit-category.spec.ts
- types/product-row.ts
- app/api/upload/shipping-confirmation/route.ts
- components/ShippingUploadPrompt.tsx
- docs/amazon-shipping-limit-release.md
- lib/amazon-shipping-evidence.test.ts
- lib/amazon-shipping-evidence.ts
- lib/amazon-shipping-extraction.ts
- lib/amazon-shipping-integration.test.ts
- lib/amazon-upload-shipping-policy.ts
- lib/amazon-upload-shipping.ts
- prisma/migrations/20261004130000_enforce_amazon_shipping/migration.sql
- tests/e2e/amazon-shipping-confirmation.spec.ts

## Local review follow-up

- Reviewed delivery parsing, selected-offer extraction, committed/cached evidence, hold and recovery actions, authenticated upload approval, cancellation, UI, and migration changes.
- Found and reproduced one issue: a message containing conflicting timing could silently accept its first relative estimate. Fixed it so mixed/alternative promises remain unknown, including arrival and dispatch text.
- Added parser and actual mocked upload/hold/recovery regressions. Unknown delivery cannot publish without approval, cannot create a confirmed shipping hold, and cannot restore an existing hold.
- Re-ran the full suite (921 passed), normal lint (zero findings), production build, TypeScript after Prisma regeneration, and whitespace checks. The 38 browser regressions remain unchanged and passed during implementation.
- No remaining findings in the reviewed paths. External services were mocked; no live listing operation, production migration, push, deployment, or worker restart was performed.

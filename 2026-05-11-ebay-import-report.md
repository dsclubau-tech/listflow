# eBay Selected-Store Import Work Report

Date: 2026-05-11

## Scope

The goal of this change was to make eBay imports selectable by store so that, when three stores are configured, the import flow can target only the chosen store's products.

The work also needed a durable summary of what was changed, what verified cleanly, and what was not exercised in this environment.

## What Was Implemented

### 1. Store-specific import entry point

A dedicated import page now exists at `app/(app)/ebay-import/page.tsx`. It loads the active stores from Prisma and hands them to the client component.

The page is reachable from the sidebar through the new `eBay Import` navigation item in `components/Sidebar.tsx`.

### 2. Store selection in the UI

The client component in `components/EbayImportClient.tsx` now presents a store selector before import starts.

Behavior:

- The selector defaults to the first available store.
- The import button is disabled until a store is selected.
- The confirmation prompt names the selected store explicitly.
- The UI shows live import progress while the server stream is running.
- The result view summarizes total, created, skipped, and failed listings.
- A collapsible error table is shown when individual listings fail.

### 3. Store-aware import API

The new route `app/api/ebay-import/route.ts` accepts `storeId` from the request body and performs the following checks:

- Confirms the user is authenticated.
- Validates that `storeId` is present.
- Confirms the store exists and is active.
- Resolves the database store ID to the eBay store number.
- Verifies the configured eBay token exists for that store.
- Streams progress events back to the client while import is running.

This keeps the selection authoritative on the server side instead of trusting the browser alone.

### 4. Import parsing and product creation

The core import logic lives in `lib/ebay-import.ts`.

That module:

- Requests active listings from eBay in pages.
- Parses the XML response using `fast-xml-parser`.
- Accepts only importable fixed-price listing types.
- Builds product data from the eBay item payload.
- Preserves item specifics, category details, images, condition, quantity, price, and policy IDs when available.
- Supports variations by importing each variation as a product variant.
- Uses a transaction-scoped advisory lock to prevent duplicate creation for the same eBay item in the same store.
- Skips listings that were already imported for that store.

### 5. eBay helper support

`lib/ebay-xml.ts` now includes `buildGetSellerListXML(page)`, which builds the Trading API request for active listings.

`lib/ebay.ts` now includes `callEbayGetSellerList(xmlBody, storeNumber)`, which sends the request with the correct eBay headers and returns the raw XML response for import parsing.

### 6. One unrelated lint issue fixed

The existing diagnostic script `scratch/diagnose-scrape.ts` had a single `any` usage that caused ESLint to fail.

That was changed to use `navigator.webdriver`, which keeps the repo lint-clean without changing behavior.

## What Worked

### Store selection

The selected store is now carried from the UI to the API as `storeId`, and then resolved server-side to the correct eBay store number and token.

This means imports no longer depend on a single implicit store context. The behavior is explicit and matches the user's requested workflow.

### Server-side validation

The API rejects bad requests early:

- missing `storeId`
- unknown store
- inactive store
- missing eBay token

This reduces the chance of importing into the wrong account or trying to import from an incomplete configuration.

### Duplicate avoidance

The import logic checks whether a product with the same `ebayItemId` already exists for that `storeId`. If it does, the item is skipped rather than duplicated.

The advisory lock also reduces the chance of two concurrent imports creating the same product at the same time.

### Progress reporting

The server sends streamed progress updates and the client displays them. That gives visibility into page-by-page import progress instead of waiting for a single opaque response.

### Build and lint

Both repository checks passed after the change:

- `npm.cmd run build`
- `npm.cmd run lint`

## What Did Not Get Fully Tested

### Live eBay import

I did not run a real eBay import against production or sandbox data in this environment.

Reason:

- It would contact the external eBay API.
- It would write real product records into the database.
- It depends on the configured store tokens being valid in the current environment.

So while the code path is implemented and the app builds cleanly, the end-to-end network import still needs a real store token and live eBay data to prove runtime behavior.

### Store credential correctness

The implementation assumes the three store tokens are configured correctly in environment variables:

- `EBAY_STORE1_TOKEN`
- `EBAY_STORE2_TOKEN`
- `EBAY_STORE3_TOKEN`

The code validates that a token exists, but it cannot verify the token's real-world validity without calling eBay.

## Verification Performed

- Production build succeeded.
- ESLint succeeded.
- The dev server is running on `http://localhost:3000`.
- `/login` responds with HTTP 200.
- `/ebay-import` redirects to login when unauthenticated, which matches the app's protected-route behavior.

## Files Touched

- `app/(app)/ebay-import/page.tsx`
- `app/api/ebay-import/route.ts`
- `components/EbayImportClient.tsx`
- `components/Sidebar.tsx`
- `lib/ebay-import.ts`
- `lib/ebay-xml.ts`
- `lib/ebay.ts`
- `scratch/diagnose-scrape.ts`

## Notes

The repo already had some unrelated local changes before this task started. I left those intact and only adjusted the files needed for the selected-store import flow and the lint fix.

## Bottom Line

The selected-store import feature is implemented, wired into the app navigation, validated server-side, and passes build/lint checks. The only remaining unknown is the live eBay API path, which still needs a real authenticated import against configured store credentials.

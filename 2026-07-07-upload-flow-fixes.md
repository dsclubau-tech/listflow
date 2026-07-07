# ListFlow Upload Flow Fixes

Date: 2026-07-07

## Summary

This note documents the production fixes made to the ListFlow draft upload and Add Product flow. The goal was to stop fragile Amazon/eBay edge cases from creating bad drafts, wrong prices, or repeated eBay upload failures.

## Add Product Fixes

- Replaced slow browser-based Add Product scraping with a direct Amazon AU HTML fetch/parser.
- Canonicalized Amazon AU product URLs to `/dp/{ASIN}` where possible.
- Added strict no-draft safety when Amazon price is missing, zero, or unreadable.
- Kept Add Product direct/API-based, without requiring the local worker.

## Amazon Price Safety

- Changed Add Product price extraction to buybox-only.
- Allowed price only from scoped selected-product containers:
  - `#corePrice_feature_div`
  - `#corePriceDisplay_desktop_feature_div`
  - `#apex_desktop`
  - `#buybox`
  - `#desktop_buybox`
- Removed unsafe Add Product price fallbacks:
  - page-wide `.a-price` scans
  - recommendation/widget prices
  - text-wide price guessing
  - selected twister price fallback
  - AOD/buying-options fallback
- Added tests proving hidden widget prices like `$98` or `$105` are ignored when the buybox has the real selected-variant price.

## Amazon Postcode Fix

- Made postcode setup resilient instead of trusting one fragile Amazon AJAX response.
- Added stronger postcode POST headers including origin, referer, AJAX headers, cookies, and CSRF token when available.
- Always refetches the canonical `/dp/{ASIN}` page after postcode setup.
- Treats postcode as usable if Amazon confirms it, or if the refetched page shows expected AU delivery/postcode signals.
- Add Product may proceed when postcode confirmation is unclear only if the refetched selected buybox price is safely readable.
- If no safe buybox price is found, ListFlow returns a clean error and creates no draft.

## Amazon Metadata Cleanup

- Improved title extraction from:
  - visible product title
  - meta title/content
  - Open Graph title
  - JSON-LD product name
- Improved image extraction to keep usable Amazon product images.
- Removed noisy Amazon script/function values from item specifics.
- Reduced irrelevant extracted specifics before upload while preserving required fields.

## Required eBay Item Specifics

- Added eBay Taxonomy required-aspect preflight before upload.
- Required specifics are now added to the draft before calling eBay when possible.
- Missing required specifics block locally with a clear `422` response instead of letting eBay fail first.
- Required rows are pinned at the top of the Item Specifications tab with required markers.
- Required fields are protected from XML trimming.

## Autofill Rules

ListFlow now resolves required specifics in this priority order:

1. User-entered value
2. Amazon exact field or variant value
3. Safe title/category inference
4. Safe eBay allowed-value fallback

Autofill coverage added or improved:

- `Brand`: Amazon Brand, Brand Name, or Manufacturer.
- `Type`: safe product-family matching for products such as chargers, lenses, foot massagers, bed wedge pillows, earbuds, headphones, and similar categories.
- `Size`: Amazon Size/Size Name/variant/dimensions first, then neutral allowed values like `One Size`, `Standard`, or `Regular` for single-size products.
- `Volume`: title/details patterns such as `946ml`, `32oz`, and `1 L`.
- `Manufacturer Part Number`: safe mapping from Amazon model/model number fields.

Guardrails:

- User-entered values always win.
- `Does not apply` is not used for descriptive required fields like Size, Type, or Volume.
- Count text such as `4Pcs` is not treated as Size unless eBay explicitly allows a matching set/count value.
- Broad values like `Other` are used only when eBay allows them and no better safe value exists.

## Draft Upload And Reconciliation

- Upload now blocks locally when required specifics are still missing.
- If eBay reports a duplicate listing but includes an item ID, ListFlow can reconcile the product instead of leaving a stale failed draft.
- After upload success or reconciled success, the Drafts UI removes the product immediately.
- Server-side repair handles products that have an eBay item ID but still show as Draft/Failed.
- Cache invalidation still runs for Products, Drafts, Price Tracker, and Action Center.

## Tests Added

Focused upload tests cover:

- Buybox-only price extraction.
- Ignoring hidden/page-wide prices.
- Postcode response parsing.
- Ambiguous postcode response plus safe buybox refetch.
- Clean failure when only page-wide prices exist.
- Required-specific inference for Brand, Type, Size, Volume, and MPN.
- User-entered required values overriding inferred values.
- Noisy Amazon script/function cleanup.
- Required specifics surviving item-specific trimming.
- Draft removal after successful/reconciled upload.

## Verification

The upload-flow fixes were verified with:

```powershell
npm.cmd run test:upload
npm.cmd run lint
npm.cmd run build
```

## Important Preservation Rules

Future upload-flow changes should preserve these rules:

- Never create a draft with missing or zero Amazon buy price.
- Never use page-wide Amazon prices for Add Product.
- Never use AOD/buying-options fallback for Add Product.
- Never call eBay AddItem when local required-specific preflight still has missing required fields.
- Never trim required item specifics from the final eBay XML.
- Keep Add Product independent from the local worker.

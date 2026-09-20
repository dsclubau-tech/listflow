# Price-check optimization rollout record

Baseline revision: `c31f47dd73e0de53aa56f2a1fbca8585aabb3667`

All optimizations are disabled unless both the feature name and store ID are
explicitly configured. Timing is controlled independently.

## Implementation commits

| Stage | Commit |
| --- | --- |
| Timing, switches, and startup revision | `2d8310c` |
| Consolidated progress writes | `a11a5e5` |
| Shared HTML snapshot | `07b156a` |
| Delivery-state experiment and comparison command | This feature series' final commit |

Initial non-secret settings: timing `false`, optimization list empty, store
allowlist empty. The 30-product comparison has not been run because no approved
representative input was included with the implementation request. Therefore
`delivery-state` remains disabled and is not approved for production writes.

## Rollout settings and results

Record the values below before every local-worker restart. Do not record secrets.

```text
Date/time:
Loaded revision:
LISTFLOW_PRICE_CHECK_TIMING_ENABLED:
LISTFLOW_PRICE_CHECK_OPTIMIZATIONS:
LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS:
Stores enabled:
Comparison input/report:
Explanation for every comparison difference:
Scheduled run job IDs:
Weighted seconds/item:
Technical failure rate:
Availability/identity failure rate:
Retries:
Decision (advance/hold/rollback):
Operator:
```

Roll out in this order: timing only, `progress-write`, `shared-snapshot`, then
`delivery-state`. Collect three comparable scheduled runs at each stage. Clear
`LISTFLOW_PRICE_CHECK_OPTIMIZATIONS` and restart the supervisor to return to the
original code path. If configuration rollback is insufficient, gracefully stop
the local workers and revert the implementation commits in reverse order.

Configuration or code rollback only affects future checks. Review and correct
any eBay listing that received a confirmed incorrect update; do not restore an
old database snapshot.

Before enabling `delivery-state`, prepare a local JSON file containing a
four-digit `postcode` and exactly 30 `products`. Each product requires an
`asin`; optional fields are `priceTrackingMode` (`REGULAR` or `DEAL`),
`variantHints`, and `scenario`. Run:

```powershell
npm.cmd run price-check:compare -- --input <input.json> --output <report.json>
```

The comparison launches the scraper directly and never imports product, job,
or eBay persistence code. It alternates baseline/experiment order. Exit code 2
means at least one price, shipping, stock, variant, identity, or failure result
differs. Explain every difference and require zero unexplained mismatches before
enabling production writes.

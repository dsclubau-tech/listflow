# Price-check optimization rollout record

Baseline revision: `c31f47dd73e0de53aa56f2a1fbca8585aabb3667`

All optimizations are disabled unless both the feature name and store ID are
explicitly configured. Timing is controlled independently.

## Implementation commits

| Stage | Commit |
| --- | --- |
| Timing, switches, and startup revision | Recorded in implementation handoff |
| Consolidated progress writes | Recorded in implementation handoff |
| Shared HTML snapshot | Recorded in implementation handoff |
| Delivery-state experiment and comparison command | This feature series' final commit |

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

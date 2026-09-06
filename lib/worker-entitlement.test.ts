import test from "node:test";
import assert from "node:assert/strict";

type Entitlement = {
  status: "ACTIVE" | "INACTIVE" | "UNAVAILABLE";
  allowedStores: number;
};

type Store = {
  id: string;
  loginId: string;
  createdAt: Date;
};

function evaluateWorkerStoreEligibility(
  targetStoreId: string,
  ownerStores: Store[],
  entitlement: Entitlement
): { eligible: boolean; reason?: string; rank?: number } {
  if (entitlement.status !== "ACTIVE" || entitlement.allowedStores <= 0) {
    return {
      eligible: false,
      reason: `Customer subscription is ${entitlement.status} (allowed: ${entitlement.allowedStores})`,
    };
  }

  // Sort by createdAt ASC
  const sorted = [...ownerStores].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  const rank = sorted.findIndex((s) => s.id === targetStoreId) + 1;
  if (rank === 0) {
    return { eligible: false, reason: "Store not found for owner" };
  }

  if (rank > entitlement.allowedStores) {
    return {
      eligible: false,
      rank,
      reason: `Store rank (${rank}) exceeds allowed store count (${entitlement.allowedStores})`,
    };
  }

  return { eligible: true, rank };
}

test("Worker Entitlement Gate - holds jobs when subscription is inactive", () => {
  const stores: Store[] = [
    { id: "store-1", loginId: "s1", createdAt: new Date("2026-01-01") },
  ];
  const result = evaluateWorkerStoreEligibility("store-1", stores, {
    status: "INACTIVE",
    allowedStores: 0,
  });

  assert.equal(result.eligible, false);
  assert.match(result.reason!, /subscription is INACTIVE/);
});

test("Worker Entitlement Gate - holds jobs when subscription is unavailable", () => {
  const stores: Store[] = [
    { id: "store-1", loginId: "s1", createdAt: new Date("2026-01-01") },
  ];
  const result = evaluateWorkerStoreEligibility("store-1", stores, {
    status: "UNAVAILABLE",
    allowedStores: 1,
  });

  assert.equal(result.eligible, false);
  assert.match(result.reason!, /subscription is UNAVAILABLE/);
});

test("Worker Entitlement Gate - per-store ranking permits rank 1 and holds rank 2 when allowedStores = 1", () => {
  const stores: Store[] = [
    { id: "store-1", loginId: "s1", createdAt: new Date("2026-01-01") },
    { id: "store-2", loginId: "s2", createdAt: new Date("2026-02-01") },
    { id: "store-3", loginId: "s3", createdAt: new Date("2026-03-01") },
  ];

  // Store 1 (oldest): rank 1 <= 1 -> ELIGIBLE
  const check1 = evaluateWorkerStoreEligibility("store-1", stores, {
    status: "ACTIVE",
    allowedStores: 1,
  });
  assert.equal(check1.eligible, true);
  assert.equal(check1.rank, 1);

  // Store 2: rank 2 > 1 -> HELD
  const check2 = evaluateWorkerStoreEligibility("store-2", stores, {
    status: "ACTIVE",
    allowedStores: 1,
  });
  assert.equal(check2.eligible, false);
  assert.equal(check2.rank, 2);
  assert.match(check2.reason!, /exceeds allowed store count/);

  // Store 3: rank 3 > 1 -> HELD
  const check3 = evaluateWorkerStoreEligibility("store-3", stores, {
    status: "ACTIVE",
    allowedStores: 1,
  });
  assert.equal(check3.eligible, false);
  assert.equal(check3.rank, 3);
});

test("Worker Entitlement Gate - per-store ranking permits rank 1 & 2 when allowedStores = 2", () => {
  const stores: Store[] = [
    { id: "store-1", loginId: "s1", createdAt: new Date("2026-01-01") },
    { id: "store-2", loginId: "s2", createdAt: new Date("2026-02-01") },
    { id: "store-3", loginId: "s3", createdAt: new Date("2026-03-01") },
  ];

  assert.equal(
    evaluateWorkerStoreEligibility("store-1", stores, {
      status: "ACTIVE",
      allowedStores: 2,
    }).eligible,
    true
  );
  assert.equal(
    evaluateWorkerStoreEligibility("store-2", stores, {
      status: "ACTIVE",
      allowedStores: 2,
    }).eligible,
    true
  );
  assert.equal(
    evaluateWorkerStoreEligibility("store-3", stores, {
      status: "ACTIVE",
      allowedStores: 2,
    }).eligible,
    false
  );
});

import test from "node:test";
import assert from "node:assert/strict";

type MockStore = {
  id: string;
  name: string;
  loginId: string;
  createdAt: Date;
};

function computeStoreRanking(stores: MockStore[], allowedStores: number) {
  // Sort by createdAt ASC
  const sorted = [...stores].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  return sorted.map((store, index) => {
    const rank = index + 1;
    return {
      ...store,
      rank,
      isEntitled: rank <= allowedStores,
    };
  });
}

test("Store Ranking - ranks stores by createdAt ASC and limits to allowedStores", () => {
  const stores: MockStore[] = [
    {
      id: "store-c",
      name: "Third Store",
      loginId: "third",
      createdAt: new Date("2026-03-01T00:00:00Z"),
    },
    {
      id: "store-a",
      name: "First Store",
      loginId: "first",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: "store-b",
      name: "Second Store",
      loginId: "second",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    },
  ];

  // Case 1: allowedStores = 1
  const ranked1 = computeStoreRanking(stores, 1);
  assert.equal(ranked1[0].id, "store-a");
  assert.equal(ranked1[0].rank, 1);
  assert.equal(ranked1[0].isEntitled, true);

  assert.equal(ranked1[1].id, "store-b");
  assert.equal(ranked1[1].rank, 2);
  assert.equal(ranked1[1].isEntitled, false);

  assert.equal(ranked1[2].id, "store-c");
  assert.equal(ranked1[2].rank, 3);
  assert.equal(ranked1[2].isEntitled, false);

  // Case 2: allowedStores = 2
  const ranked2 = computeStoreRanking(stores, 2);
  assert.equal(ranked2[0].isEntitled, true);
  assert.equal(ranked2[1].isEntitled, true);
  assert.equal(ranked2[2].isEntitled, false);

  // Case 3: allowedStores = 0
  const ranked0 = computeStoreRanking(stores, 0);
  assert.equal(ranked0.every((s) => !s.isEntitled), true);
});

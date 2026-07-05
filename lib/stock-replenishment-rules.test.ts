import assert from "node:assert/strict";
import test from "node:test";
import { ProductStatus } from "@/app/generated/prisma/enums";
import { getStockReplenishmentCandidates } from "@/lib/stock-replenishment-rules";

test("getStockReplenishmentCandidates restores imported listing below target quantity", () => {
  const candidates = getStockReplenishmentCandidates(
    [
      {
        id: "product-1",
        title: "Test product",
        ebayItemId: "123",
        quantity: 5,
        status: ProductStatus.IMPORTED,
        variantCount: 1,
      },
    ],
    [{ itemId: "123", quantityAvailable: 4 }],
  );

  assert.deepEqual(candidates, [
    {
      productId: "product-1",
      ebayItemId: "123",
      title: "Test product",
      ebayQuantity: 4,
      targetQuantity: 5,
    },
  ]);
});

test("getStockReplenishmentCandidates skips held and zero-quantity products", () => {
  const candidates = getStockReplenishmentCandidates(
    [
      {
        id: "held",
        title: "Held product",
        ebayItemId: "1",
        quantity: 5,
        status: ProductStatus.ON_HOLD,
      },
      {
        id: "zero",
        title: "Zero quantity product",
        ebayItemId: "2",
        quantity: 0,
        status: ProductStatus.IMPORTED,
      },
    ],
    [
      { itemId: "1", quantityAvailable: 0 },
      { itemId: "2", quantityAvailable: 0 },
    ],
  );

  assert.deepEqual(candidates, []);
});

test("getStockReplenishmentCandidates skips listings already at or above target", () => {
  const candidates = getStockReplenishmentCandidates(
    [
      {
        id: "product-1",
        title: "Test product",
        ebayItemId: "123",
        quantity: 5,
        status: ProductStatus.IMPORTED,
      },
    ],
    [{ itemId: "123", quantityAvailable: 5 }],
  );

  assert.deepEqual(candidates, []);
});

test("getStockReplenishmentCandidates skips multi-variation listings", () => {
  const candidates = getStockReplenishmentCandidates(
    [
      {
        id: "product-1",
        title: "Variation product",
        ebayItemId: "123",
        quantity: 5,
        status: ProductStatus.IMPORTED,
        variantCount: 2,
      },
    ],
    [{ itemId: "123", quantityAvailable: 0 }],
  );

  assert.deepEqual(candidates, []);
});

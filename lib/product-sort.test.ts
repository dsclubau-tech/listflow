import assert from "node:assert/strict";
import test from "node:test";
import {
  getProductDisplaySellPrices,
  sortProductsByDisplayValue,
  type ProductSortCandidate,
} from "@/lib/product-sort";

function candidate(
  id: string,
  price: string,
  variants: ProductSortCandidate["variants"],
): ProductSortCandidate {
  return { id, price, amazonPrice: null, variants };
}

test("getProductDisplaySellPrices uses variant prices and product fallback", () => {
  assert.deepEqual(
    getProductDisplaySellPrices(
      candidate("variants", "999", [
        { buyPrice: "10", sellPrice: "35" },
        { buyPrice: "10", sellPrice: "20" },
      ]),
    ),
    [35, 20],
  );
  assert.deepEqual(
    getProductDisplaySellPrices(candidate("fallback", "42", [])),
    [42],
  );
});

test("price sorting uses the lowest displayed sell price and reverses direction", () => {
  const products = [
    candidate("range", "999", [
      { buyPrice: "10", sellPrice: "45" },
      { buyPrice: "10", sellPrice: "25" },
    ]),
    candidate("high", "60", []),
    candidate("low", "15", []),
  ];

  assert.deepEqual(
    sortProductsByDisplayValue(products, "price", "asc").map(({ id }) => id),
    ["low", "range", "high"],
  );
  assert.deepEqual(
    sortProductsByDisplayValue(products, "price", "desc").map(({ id }) => id),
    ["high", "range", "low"],
  );
});

test("profit sorting uses displayed net profit after fees", () => {
  const products = [
    candidate("profit-24", "999", [
      {
        buyPrice: "100",
        sellPrice: "140",
        feesPercent: 10,
        feesFixed: 2,
      },
    ]),
    candidate("profit-10", "120", [
      { buyPrice: "90", sellPrice: "112", feesPercent: 10, feesFixed: 0.8 },
    ]),
  ];

  assert.deepEqual(
    sortProductsByDisplayValue(products, "profit", "asc").map(({ id }) => id),
    ["profit-10", "profit-24"],
  );
});

test("sold sorting sorts products by quantitySold ascending and descending", () => {
  const products: ProductSortCandidate[] = [
    { ...candidate("p1", "50", []), quantitySold: 5 },
    { ...candidate("p2", "50", []), quantitySold: 0 },
    { ...candidate("p3", "50", []), quantitySold: 12 },
  ];

  assert.deepEqual(
    sortProductsByDisplayValue(products, "sold", "asc").map(({ id }) => id),
    ["p2", "p1", "p3"],
  );
  assert.deepEqual(
    sortProductsByDisplayValue(products, "sold", "desc").map(({ id }) => id),
    ["p3", "p1", "p2"],
  );
});

test("uploaded sorting sorts products by uploaded timestamp ascending and descending", () => {
  const products: ProductSortCandidate[] = [
    { ...candidate("p1", "50", []), uploadedAt: "2026-08-20T10:00:00.000Z" },
    { ...candidate("p2", "50", []), uploadedAt: "2026-08-10T10:00:00.000Z" },
    { ...candidate("p3", "50", []), uploadedAt: "2026-08-28T10:00:00.000Z" },
  ];

  assert.deepEqual(
    sortProductsByDisplayValue(products, "uploaded", "asc").map(({ id }) => id),
    ["p2", "p1", "p3"],
  );
  assert.deepEqual(
    sortProductsByDisplayValue(products, "uploaded", "desc").map(({ id }) => id),
    ["p3", "p1", "p2"],
  );
});

test("views sorting sorts products by ebayViewCount ascending and descending", () => {
  const products: ProductSortCandidate[] = [
    { ...candidate("p1", "50", []), ebayViewCount: 42 },
    { ...candidate("p2", "50", []), ebayViewCount: 0 },
    { ...candidate("p3", "50", []), ebayViewCount: 150 },
  ];

  assert.deepEqual(
    sortProductsByDisplayValue(products, "views", "asc").map(({ id }) => id),
    ["p2", "p1", "p3"],
  );
  assert.deepEqual(
    sortProductsByDisplayValue(products, "views", "desc").map(({ id }) => id),
    ["p3", "p1", "p2"],
  );
});


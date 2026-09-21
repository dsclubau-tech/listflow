import assert from "node:assert/strict";
import test from "node:test";
import { PromotedAdRateStrategy, PromotedAdStatus } from "@/app/generated/prisma/enums";
import {
  buildProductsWhere,
  normalizeProductsQuery,
} from "@/lib/product-filter-query";

function stringify(value: unknown) {
  return JSON.stringify(value);
}

test("normalizeProductsQuery parses range and select filters", () => {
  const query = normalizeProductsQuery({
    pageSize: "50",
    page: "3",
    sortBy: "profit",
    sortOrder: "desc",
    profitMin: "4",
    profitMax: "12",
    sellPriceMin: "100",
    buyPriceMax: "80",
    quantityMin: "1",
    feesPercentMax: "13.25",
    promotedAdPercentMin: "3",
    adFeeStatus: "promoted",
    inventoryStatus: "on-hold",
    stockMonitoring: "low-stock",
    priceMonitoring: "checked",
    autoOrder: "configured",
    veroViolation: "potential",
  });

  assert.equal(query.pageSize, 50);
  assert.equal(query.requestedPage, 3);
  assert.equal(query.sortBy, "profit");
  assert.equal(query.sortOrder, "desc");
  assert.equal(query.profitMin, 4);
  assert.equal(query.profitMax, 12);
  assert.equal(query.sellPriceMin, 100);
  assert.equal(query.buyPriceMax, 80);
  assert.equal(query.quantityMin, 1);
  assert.equal(query.feesPercentMax, 13.25);
  assert.equal(query.promotedAdPercentMin, 3);
  assert.equal(query.adFeeStatus, "promoted");
  assert.equal(query.inventoryStatus, "on-hold");
  assert.equal(query.stockMonitoring, "low-stock");
  assert.equal(query.priceMonitoring, "checked");
  assert.equal(query.autoOrder, "configured");
  assert.equal(query.veroViolation, "potential");
});

test("normalizeProductsQuery ignores unsupported product sorting", () => {
  const query = normalizeProductsQuery({
    sortBy: "title",
    sortOrder: "sideways",
  });

  assert.equal(query.sortBy, null);
  assert.equal(query.sortOrder, "asc");
});

test("normalizeProductsQuery accepts every Products page row option", () => {
  for (const pageSize of [10, 20, 50, 100, 200]) {
    assert.equal(normalizeProductsQuery({ pageSize: String(pageSize) }).pageSize, pageSize);
  }

  assert.equal(normalizeProductsQuery({ pageSize: "25" }).pageSize, 100);
});

test("buildProductsWhere keeps profit out of Prisma filters", () => {
  const where = buildProductsWhere(
    "store-1",
    normalizeProductsQuery({ profitMin: "4", profitMax: "12" })
  );
  const serialized = stringify(where);

  assert.equal(serialized.includes("profitFixed"), false);
  assert.equal(serialized.includes("profitPercent"), false);
});

test("buildProductsWhere applies search filters", () => {
  const where = buildProductsWhere(
    "store-1",
    normalizeProductsQuery({ q: "charger" })
  );
  const serialized = stringify(where);

  assert.equal(serialized.includes("charger"), true);
  assert.equal(serialized.includes("title"), true);
  assert.equal(serialized.includes("fullTitle"), true);
  assert.equal(serialized.includes("asin"), true);
  assert.equal(serialized.includes("ebayItemId"), true);
});

test("buildProductsWhere applies decimal fee ranges to their matching units", () => {
  const where = buildProductsWhere(
    "store-1",
    normalizeProductsQuery({
      sellPriceMin: "20",
      sellPriceMax: "60",
      buyPriceMin: "10",
      buyPriceMax: "30",
      quantityMin: "1",
      quantityMax: "5",
      feesPercentMin: "0.35",
      feesPercentMax: "13.25",
      feesFixedMin: "3.50",
      feesFixedMax: "3.50",
    })
  );
  const serialized = stringify(where);

  assert.equal(serialized.includes("sellPrice"), true);
  assert.equal(serialized.includes("amazonPrice"), true);
  assert.equal(serialized.includes("buyPrice"), true);
  assert.equal(serialized.includes("quantity"), true);
  assert.equal(serialized.includes("feesPercent"), true);
  assert.equal(serialized.includes("feesFixed"), true);
  const variantsClause = (where.AND as Array<Record<string, unknown>>).find(
    (clause) => "variants" in clause,
  ) as { variants: { some: Record<string, unknown> } };
  assert.deepEqual(variantsClause.variants.some, {
    feesPercent: { gte: 0.35, lte: 13.25 },
    feesFixed: { gte: 3.5, lte: 3.5 },
  });
});

test("legacy fees links map to percentage only and preserve zero", () => {
  const query = normalizeProductsQuery({ feesMin: "0", feesMax: "0.35" });
  assert.equal(query.feesPercentMin, 0);
  assert.equal(query.feesPercentMax, 0.35);
  assert.equal(query.feesFixedMin, null);
  assert.equal(query.feesFixedMax, null);
});

test("buildProductsWhere applies stock and price monitoring filters", () => {
  const where = buildProductsWhere(
    "store-1",
    normalizeProductsQuery({
      stockMonitoring: "has-stock-data",
      priceMonitoring: "needs-changing-price",
      autoOrder: "not-configured",
    })
  );
  const serialized = stringify(where);

  assert.equal(serialized.includes("amazonStockLeft"), true);
  assert.equal(serialized.includes("priceHistory"), true);
  assert.equal(serialized.includes("automation"), true);
});

test("buildProductsWhere applies failed/on-hold tab filter", () => {
  const where = buildProductsWhere(
    "store-1",
    normalizeProductsQuery({ filter: "failed-on-hold" })
  );
  const serialized = stringify(where);

  assert.equal(serialized.includes("ON_HOLD"), true);
  assert.equal(serialized.includes("priceCheckError"), true);
});

test("buildProductsWhere applies promoted ad rate and status filters", () => {
  const where = buildProductsWhere(
    "store-1",
    normalizeProductsQuery({
      promotedAdPercentMin: "3",
      adFeeStatus: "promoted",
    })
  );
  const notPromotedWhere = buildProductsWhere(
    "store-1",
    normalizeProductsQuery({ adFeeStatus: "not-promoted" })
  );
  const notSyncedWhere = buildProductsWhere(
    "store-1",
    normalizeProductsQuery({ adFeeStatus: "not-synced" })
  );
  const serialized = stringify(where);

  assert.equal(serialized.includes(PromotedAdStatus.PROMOTED), true);
  assert.equal(serialized.includes(PromotedAdRateStrategy.FIXED), true);
  assert.equal(serialized.includes("promotedAdPercent"), true);
  assert.equal(
    stringify(notPromotedWhere).includes(PromotedAdStatus.NOT_PROMOTED),
    true
  );
  assert.equal(stringify(notSyncedWhere).includes(PromotedAdStatus.UNKNOWN), true);
  assert.equal(stringify(notSyncedWhere).includes("promotedAdSyncedAt"), true);
});

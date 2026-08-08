import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductFilterUrl,
  buildProductSortUrl,
} from "@/lib/product-filter-navigation";

test("product quick filters preserve the current query and reset pagination", () => {
  const url = buildProductFilterUrl(
    "/products",
    "page=4&pageSize=100&q=desk&quantityMin=1",
    "needs-changing-price",
  );
  const parsed = new URL(url, "https://listflow.local");

  assert.equal(parsed.searchParams.get("page"), "1");
  assert.equal(parsed.searchParams.get("pageSize"), "100");
  assert.equal(parsed.searchParams.get("q"), "desk");
  assert.equal(parsed.searchParams.get("quantityMin"), "1");
  assert.equal(parsed.searchParams.get("filter"), "needs-changing-price");
});

test("the all quick filter removes only the quick-filter parameter", () => {
  const url = buildProductFilterUrl(
    "/products",
    "page=2&pageSize=50&filter=failed-on-hold&inventoryStatus=on-hold",
    "all",
  );
  const parsed = new URL(url, "https://listflow.local");

  assert.equal(parsed.searchParams.get("page"), "1");
  assert.equal(parsed.searchParams.get("pageSize"), "50");
  assert.equal(parsed.searchParams.get("inventoryStatus"), "on-hold");
  assert.equal(parsed.searchParams.has("filter"), false);
});

test("product sorting preserves filters, resets pagination, and toggles direction", () => {
  const ascendingUrl = buildProductSortUrl(
    "/products",
    "page=4&pageSize=50&q=desk&profitMin=5",
    "price",
  );
  const ascending = new URL(ascendingUrl, "https://listflow.local");

  assert.equal(ascending.searchParams.get("page"), "1");
  assert.equal(ascending.searchParams.get("pageSize"), "50");
  assert.equal(ascending.searchParams.get("q"), "desk");
  assert.equal(ascending.searchParams.get("profitMin"), "5");
  assert.equal(ascending.searchParams.get("sortBy"), "price");
  assert.equal(ascending.searchParams.get("sortOrder"), "asc");

  const descendingUrl = buildProductSortUrl(
    "/products",
    ascending.search.slice(1),
    "price",
  );
  const descending = new URL(descendingUrl, "https://listflow.local");

  assert.equal(descending.searchParams.get("sortOrder"), "desc");
});

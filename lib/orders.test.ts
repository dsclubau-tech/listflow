import assert from "node:assert/strict";
import test from "node:test";
import { matchOrderProduct, orderAmounts, parseOrderEdit, toOrderRow, type OrderMatchProduct } from "./orders";

const product: OrderMatchProduct = {
  id: "product", storeId: "store", ebayItemId: "123", asin: "B012345678", amazonPrice: 10, images: ["product.jpg"],
  promotedAdStatus: "NOT_PROMOTED", promotedAdPercent: 0, promotedAdRateStrategy: "FIXED",
  variants: [{ id: "variant", sku: "sku", buyPrice: 10, feesPercent: 10, feesFixed: 0.3, images: ["variant.jpg"] }],
};
const line = { ebayItemId: "123", ebayVariationId: null, sku: "sku" };

test("matches listing and variant SKU only within the current store", () => {
  assert.equal(matchOrderProduct("store", line, [product])?.variant?.id, "variant");
  assert.equal(matchOrderProduct("other", line, [product]), null);
  assert.equal(matchOrderProduct("store", { ...line, ebayItemId: "456" }, [product]), null);
  assert.equal(matchOrderProduct("store", { ...line, sku: "wrong" }, [product]), null);
});

test("ambiguous products/variants and unidentified variations remain unmatched", () => {
  assert.equal(matchOrderProduct("store", line, [product, { ...product, id: "duplicate" }]), null);
  assert.equal(matchOrderProduct("store", line, [{ ...product, variants: [...product.variants, { ...product.variants[0], id: "duplicate" }] }]), null);
  assert.equal(matchOrderProduct("store", { ...line, sku: null, ebayVariationId: "variation" }, [product]), null);
  assert.equal(matchOrderProduct("store", { ...line, sku: null }, [{ ...product, variants: [...product.variants, { ...product.variants[0], id: "another", sku: "another" }] }]), null);
});

test("sale line totals and current product cost use existing profit and per-unit fees", () => {
  const match = matchOrderProduct("store", line, [product]);
  assert.deepEqual(orderAmounts(match, 50, 2, "AUD"), { buyTotal: 20, profit: 24.4 });
  const changed = { ...product, variants: [{ ...product.variants[0], buyPrice: 12 }] };
  assert.deepEqual(orderAmounts(matchOrderProduct("store", line, [changed]), 50, 2, "AUD"), { buyTotal: 24, profit: 20.4 });
  assert.deepEqual(orderAmounts(null, 50, 2, "AUD"), { buyTotal: null, profit: null });
  assert.deepEqual(orderAmounts(match, 50, 2, "USD"), { buyTotal: 20, profit: null });
});

test("zero costs stay valid; missing cost does not invent profit", () => {
  assert.deepEqual(orderAmounts({ product, variant: { ...product.variants[0], buyPrice: 0 } }, 5, 1, "AUD"), { buyTotal: 0, profit: 4.2 });
  assert.deepEqual(orderAmounts({ product: { ...product, amazonPrice: null }, variant: null }, 5, 1, "AUD"), { buyTotal: null, profit: null });
});

test("row uses purchased title, matched image, and supplier identity", () => {
  const row = toOrderRow({ ...line, id: "line", title: "Purchased title", quantity: 2, sellTotal: "50.00", currency: "AUD", status: "ORDERED", estimatedArrival: "2026-10-12" }, matchOrderProduct("store", line, [product]));
  assert.equal(row.image, "variant.jpg");
  assert.equal(row.title, "Purchased title");
  assert.equal(row.buyItemId, "B012345678");
  assert.equal(row.estimatedArrival, "2026-10-12");
});

test("all five exact statuses and calendar dates can be edited independently", () => {
  for (const status of ["PENDING", "ORDERED", "SHIPPED", "DELIVERED", "CANCELED"]) assert.deepEqual(parseOrderEdit({ status }), { status });
  assert.deepEqual(parseOrderEdit({ estimatedArrival: "2028-02-29" }), { estimatedArrival: "2028-02-29" });
  assert.deepEqual(parseOrderEdit({ estimatedArrival: null }), { estimatedArrival: null });
  for (const estimatedArrival of ["2026-02-29", "2026-02-30", "2026-13-01", "0000-01-01", "2026-10-08T12:00:00Z", "", 12]) {
    assert.throws(() => parseOrderEdit({ estimatedArrival }));
  }
  for (const body of [{ status: "Unmonitored" }, { sellTotal: 1 }, { storeId: "other" }, {}, null, []]) assert.throws(() => parseOrderEdit(body));
});

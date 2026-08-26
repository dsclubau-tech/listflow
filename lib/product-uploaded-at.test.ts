import assert from "node:assert/strict";
import test from "node:test";
import { getProductUploadedAt } from "./product-uploaded-at";

const productCreatedAt = new Date("2026-08-27T03:08:00.000Z");

test("uses the successful upload timestamp when one exists", () => {
  const successfulUploadAt = new Date("2026-08-26T03:08:00.000Z");

  assert.equal(
    getProductUploadedAt({
      successfulUploadAt,
      productCreatedAt,
      ebayItemId: "307079300000",
      status: "ON_HOLD",
    }),
    successfulUploadAt,
  );
});

test("falls back to the ListFlow import timestamp for a listed eBay product", () => {
  assert.equal(
    getProductUploadedAt({
      successfulUploadAt: null,
      productCreatedAt,
      ebayItemId: "307079300000",
      status: "ON_HOLD",
    }),
    productCreatedAt,
  );
});

test("does not assign an upload timestamp to an unlisted draft", () => {
  assert.equal(
    getProductUploadedAt({
      successfulUploadAt: null,
      productCreatedAt,
      ebayItemId: null,
      status: "DRAFT",
    }),
    null,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveAmazonDeliveryPostcode } from "./amazon-delivery-postcode";

test("Amazon delivery postcode uses only its own setting", () => {
  assert.equal(resolveAmazonDeliveryPostcode("2217"), "2217");
  assert.equal(resolveAmazonDeliveryPostcode("0800"), "0800");
  assert.equal(resolveAmazonDeliveryPostcode(null), "2217");
  assert.equal(resolveAmazonDeliveryPostcode(""), "2217");
});

test("malformed or unknown scraper postcodes cannot silently fall back", () => {
  for (const value of ["221", "22170", "abcd", "0000", 2217]) {
    assert.throws(() => resolveAmazonDeliveryPostcode(value), /Amazon Delivery Postcode/);
  }
});

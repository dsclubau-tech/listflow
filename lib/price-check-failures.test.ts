import assert from "node:assert/strict";
import test from "node:test";
import { PriceCheckFailureCode } from "@/app/generated/prisma/enums";
import {
  PriceCheckFailure,
  getAmazonTechnicalPageMessage,
  getPriceCheckFailureCode,
  isAutoHoldPriceCheckFailureCode,
  isPriceCheckAutoHoldMetadata,
  selectPriceCheckAutoHoldProductIds,
} from "@/lib/price-check-failures";

test("only confirmed product failures are eligible for automatic hold", () => {
  assert.equal(isAutoHoldPriceCheckFailureCode(PriceCheckFailureCode.AMAZON_OUT_OF_STOCK), true);
  assert.equal(isAutoHoldPriceCheckFailureCode(PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE), true);
  assert.equal(isAutoHoldPriceCheckFailureCode(PriceCheckFailureCode.MISSING_BASELINE), true);
  assert.equal(isAutoHoldPriceCheckFailureCode(PriceCheckFailureCode.UNSAFE_PRICE_CHANGE), true);
  assert.equal(isAutoHoldPriceCheckFailureCode(PriceCheckFailureCode.TECHNICAL_ERROR), false);
  assert.equal(isAutoHoldPriceCheckFailureCode(null), false);
});

test("typed failures retain their code and unknown errors are technical", () => {
  const outOfStock = new PriceCheckFailure(
    PriceCheckFailureCode.AMAZON_OUT_OF_STOCK,
    "Out of stock",
  );

  assert.equal(getPriceCheckFailureCode(outOfStock), PriceCheckFailureCode.AMAZON_OUT_OF_STOCK);
  assert.equal(getPriceCheckFailureCode(new Error("Timeout")), PriceCheckFailureCode.TECHNICAL_ERROR);
});

test("Amazon challenge and temporary error pages are technical", () => {
  assert.match(
    getAmazonTechnicalPageMessage({
      title: "Robot Check",
      url: "https://www.amazon.com.au/errors/validateCaptcha",
      bodyText: "Enter the characters you see below",
    }) ?? "",
    /challenge/i,
  );
  assert.equal(
    getAmazonTechnicalPageMessage({
      title: "Example product",
      url: "https://www.amazon.com.au/dp/B07VJ5LG19",
      bodyText: "Example product details",
    }),
    null,
  );
});

test("automatic hold metadata is identified without affecting manual holds", () => {
  assert.equal(isPriceCheckAutoHoldMetadata({ kind: "price-check-auto-hold" }), true);
  assert.equal(isPriceCheckAutoHoldMetadata({}), false);
  assert.equal(isPriceCheckAutoHoldMetadata(null), false);
});

test("automatic hold candidates require a current product failure and are deduped", () => {
  const products = [
    {
      id: "eligible",
      status: "IMPORTED",
      ebayItemId: "123",
      priceCheckError: "No price",
      priceCheckFailureCode: PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE,
    },
    {
      id: "technical",
      status: "IMPORTED",
      ebayItemId: "456",
      priceCheckError: "Timeout",
      priceCheckFailureCode: PriceCheckFailureCode.TECHNICAL_ERROR,
    },
    {
      id: "cleared",
      status: "IMPORTED",
      ebayItemId: "789",
      priceCheckError: null,
      priceCheckFailureCode: null,
    },
  ];

  assert.deepEqual(
    selectPriceCheckAutoHoldProductIds({ enabled: true, products }),
    ["eligible"],
  );
  assert.deepEqual(
    selectPriceCheckAutoHoldProductIds({
      enabled: true,
      products,
      coveredProductIds: ["eligible"],
    }),
    [],
  );
  assert.deepEqual(
    selectPriceCheckAutoHoldProductIds({ enabled: false, products }),
    [],
  );
});

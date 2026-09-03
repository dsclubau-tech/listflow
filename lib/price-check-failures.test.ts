import assert from "node:assert/strict";
import test from "node:test";
import { PriceCheckFailureCode } from "@/app/generated/prisma/enums";
import {
  DEAL_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
  REGULAR_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
  PriceCheckFailure,
  getPriceCheckAutoHoldReason,
  getPriceCheckAutoResumeMetadata,
  getAmazonTechnicalPageMessage,
  getPriceCheckFailureCode,
  isAutoHoldPriceCheckFailureCode,
  isVerifiedAmazonProductPage,
  isPriceCheckAutoHoldMetadata,
  isPriceCheckAutoResumeMetadata,
  isRecoveredLowStockAutoHold,
  isRecoveredRegularPriceAutoHold,
  isRecoveredPriceCheckAutoHold,
  selectPriceCheckAutoHoldProductIds,
  selectPriceCheckAutoResumeProductIds,
} from "@/lib/price-check-failures";

test("only confirmed product failures are eligible for automatic hold", () => {
  assert.equal(isAutoHoldPriceCheckFailureCode(PriceCheckFailureCode.AMAZON_OUT_OF_STOCK), true);
  assert.equal(isAutoHoldPriceCheckFailureCode(PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE), true);
  assert.equal(isAutoHoldPriceCheckFailureCode(PriceCheckFailureCode.AMAZON_ASIN_REDIRECT), true);
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
  const asinRedirect = new PriceCheckFailure(
    PriceCheckFailureCode.AMAZON_ASIN_REDIRECT,
    "Redirected to different variant",
  );

  assert.equal(getPriceCheckFailureCode(outOfStock), PriceCheckFailureCode.AMAZON_OUT_OF_STOCK);
  assert.equal(getPriceCheckFailureCode(asinRedirect), PriceCheckFailureCode.AMAZON_ASIN_REDIRECT);
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

test("Amazon not-found pages are technical", () => {
  assert.match(
    getAmazonTechnicalPageMessage({
      title: "Page Not Found",
      url: "https://www.amazon.com.au/dp/B000000000",
      bodyText: "The Web address you've entered is not a functioning page.",
    }) ?? "",
    /temporary error page/i,
  );
});

test("verifies an Amazon product page from the requested ASIN in its URL", () => {
  assert.equal(
    isVerifiedAmazonProductPage({
      expectedAsin: "B0G64ZJ5MQ",
      url: "https://www.amazon.com.au/dp/B0G64ZJ5MQ?th=1",
    }),
    true,
  );
  assert.equal(
    isVerifiedAmazonProductPage({
      expectedAsin: "B0G64ZJ5MQ",
      url: "https://www.amazon.com.au/product-title/dp/B0G64ZJ5MQ/ref=abc",
    }),
    true,
  );
});

test("does not verify the wrong Amazon product or a non-Amazon URL", () => {
  assert.equal(
    isVerifiedAmazonProductPage({
      expectedAsin: "B0G64ZJ5MQ",
      url: "https://www.amazon.com.au/dp/B000000000",
      pageAsins: ["B000000000"],
    }),
    false,
  );
  assert.equal(
    isVerifiedAmazonProductPage({
      expectedAsin: "B0G64ZJ5MQ",
      url: "https://example.com/dp/B0G64ZJ5MQ",
    }),
    false,
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

test("automatic hold reasons are stable for later recovery checks", () => {
  assert.equal(
    getPriceCheckAutoHoldReason(" Deal price is no longer available on Amazon. "),
    DEAL_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
  );
  assert.equal(
    getPriceCheckAutoHoldReason(null),
    "Automatic hold after failed price check.",
  );
});

test("automatic resume metadata identifies recovered price-check actions", () => {
  const metadata = getPriceCheckAutoResumeMetadata({
    sourcePriceCheckJobId: "price-job-1",
  });

  assert.deepEqual(metadata, {
    kind: "price-check-auto-resume",
    reason: "limited-time-deal-price-restored",
    sourcePriceCheckJobId: "price-job-1",
  });
  assert.equal(isPriceCheckAutoResumeMetadata(metadata), true);
  assert.equal(isPriceCheckAutoResumeMetadata({ kind: "price-check-auto-hold" }), false);
});

test("automatic resume candidates only include recovered false deal-price holds", () => {
  const recovered = {
    id: "recovered",
    status: "ON_HOLD",
    ebayItemId: "123",
    amazonPriceTrackingMode: "DEAL",
    amazonPrice: 210.98,
    holdReason: DEAL_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
    priceCheckError: null,
    priceCheckFailureCode: null,
    amazonStockLeft: 1,
  };
  const products = [
    recovered,
    { ...recovered, id: "manual", holdReason: "Put on hold manually." },
    { ...recovered, id: "unresolved", priceCheckError: "Still unavailable" },
    {
      ...recovered,
      id: "other-failure",
      holdReason:
        "Automatic hold after failed price check: Regular price is no longer available on Amazon.",
    },
    { ...recovered, id: "regular", amazonPriceTrackingMode: "REGULAR" },
    { ...recovered, id: "missing-price", amazonPrice: null },
    { ...recovered, id: "missing-ebay", ebayItemId: null },
    { ...recovered, id: "already-active", status: "IMPORTED" },
  ];

  assert.deepEqual(selectPriceCheckAutoResumeProductIds({ products }), [
    "recovered",
  ]);
  assert.deepEqual(
    selectPriceCheckAutoResumeProductIds({
      products,
      coveredProductIds: ["recovered"],
    }),
    [],
  );
});

test("automatic resume candidates include resolved low-stock holds but exclude unsafe holds", () => {
  const recoveredStock = {
    id: "stock-recovered",
    status: "ON_HOLD",
    ebayItemId: "123",
    amazonPriceTrackingMode: "REGULAR",
    amazonPrice: 187.94,
    holdReason: "Low Amazon stock resolved — product is back in stock on Amazon.",
    priceCheckError: null,
    priceCheckFailureCode: null,
    amazonStockLeft: null,
  };
  const products = [
    recoveredStock,
    { ...recoveredStock, id: "healthy-count", amazonStockLeft: 8 },
    { ...recoveredStock, id: "still-low", amazonStockLeft: 3 },
    { ...recoveredStock, id: "manual", holdReason: "Put on hold manually." },
    {
      ...recoveredStock,
      id: "failed-check",
      priceCheckError: "Amazon check failed",
      priceCheckFailureCode: PriceCheckFailureCode.TECHNICAL_ERROR,
    },
    { ...recoveredStock, id: "missing-ebay", ebayItemId: null },
  ];

  assert.equal(isRecoveredLowStockAutoHold(recoveredStock), true);
  assert.equal(isRecoveredPriceCheckAutoHold(recoveredStock), true);
  assert.deepEqual(selectPriceCheckAutoResumeProductIds({ products }), [
    "stock-recovered",
    "healthy-count",
  ]);
  assert.deepEqual(
    selectPriceCheckAutoResumeProductIds({
      products,
      coveredProductIds: ["stock-recovered", "healthy-count"],
    }),
    [],
  );
});

test("automatic resume candidates include recovered regular-price holds", () => {
  const recoveredRegular = {
    id: "recovered-regular",
    status: "ON_HOLD",
    ebayItemId: "123",
    amazonPriceTrackingMode: "REGULAR",
    amazonPrice: 299.00,
    holdReason: REGULAR_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
    priceCheckError: null,
    priceCheckFailureCode: null,
    amazonStockLeft: null,
  };
  const products = [
    recoveredRegular,
    { ...recoveredRegular, id: "unresolved-err", priceCheckError: "Error" },
    { ...recoveredRegular, id: "no-price", amazonPrice: null },
    { ...recoveredRegular, id: "out-of-stock", amazonStockLeft: 0 },
  ];

  assert.equal(isRecoveredRegularPriceAutoHold(recoveredRegular), true);
  assert.equal(isRecoveredPriceCheckAutoHold(recoveredRegular), true);
  assert.deepEqual(selectPriceCheckAutoResumeProductIds({ products }), [
    "recovered-regular",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySoldPageState,
  medianOf,
  parsePriceText,
  trimPriceOutliers,
} from "@/lib/ebay-research-sold";

test("parsePriceText reads a plain price", () => {
  assert.equal(parsePriceText("AU $12.34"), 12.34);
});

test("parsePriceText strips thousands separators", () => {
  assert.equal(parsePriceText("$1,299.00"), 1299);
});

test("parsePriceText returns the midpoint of a price range", () => {
  assert.equal(parsePriceText("$10.00 to $18.00"), 14);
});

test("parsePriceText ignores a reversed range and takes the first number", () => {
  assert.equal(parsePriceText("$20 to $10"), 20);
});

test("parsePriceText returns 0 when there is no number", () => {
  assert.equal(parsePriceText("Free postage"), 0);
  assert.equal(parsePriceText(null), 0);
});

test("medianOf handles odd, even, and empty inputs", () => {
  assert.equal(medianOf([1, 2, 3]), 2);
  assert.equal(medianOf([1, 2, 3, 4]), 2.5);
  assert.equal(medianOf([]), null);
});

test("trimPriceOutliers leaves small samples untouched", () => {
  const prices = [1, 2, 3, 4, 5];
  assert.deepEqual(trimPriceOutliers(prices), prices);
});

test("trimPriceOutliers drops the extreme 10% at each end", () => {
  // 20 values sorted; 10% = 2 dropped from each end.
  const prices = Array.from({ length: 20 }, (_, index) => index + 1);
  const trimmed = trimPriceOutliers(prices);

  assert.equal(trimmed[0], 3);
  assert.equal(trimmed[trimmed.length - 1], 18);
  assert.equal(trimmed.length, 16);
});

test("trimming stops one outlier from skewing the median", () => {
  const prices = [10, 10, 11, 11, 12, 12, 13, 13, 14, 900].sort(
    (left, right) => left - right,
  );

  assert.equal(medianOf(trimPriceOutliers(prices)), 12);
});

test("classifySoldPageState detects real results", () => {
  assert.equal(
    classifySoldPageState({
      url: "https://www.ebay.com.au/sch/i.html",
      title: "sony wh-1000xm5 | eBay",
      legacyCards: 42,
      newLayoutCards: 0,
      hasZeroResultsMarker: false,
    }),
    "ok",
  );
});

test("classifySoldPageState flags a sign-in redirect as auth (not a retryable block)", () => {
  assert.equal(
    classifySoldPageState({
      url: "https://signin.ebay.com.au/ws/eBayISAPI.dll?SignIn&sgfl=srch",
      title: "Sign in or Register | eBay",
      legacyCards: 0,
      newLayoutCards: 0,
      hasZeroResultsMarker: false,
    }),
    "auth",
  );
});

test("classifySoldPageState treats a captcha interstitial as a retryable block", () => {
  assert.equal(
    classifySoldPageState({
      url: "https://www.ebay.com.au/splashui/captcha",
      title: "Checking your browser",
      legacyCards: 0,
      newLayoutCards: 0,
      hasZeroResultsMarker: false,
    }),
    "blocked",
  );
});

test("classifySoldPageState accepts a genuine zero-results page", () => {
  assert.equal(
    classifySoldPageState({
      url: "https://www.ebay.com.au/sch/i.html",
      title: "obscure-thing | eBay",
      legacyCards: 0,
      newLayoutCards: 0,
      hasZeroResultsMarker: true,
    }),
    "empty",
  );
});

test("classifySoldPageState flags an unrecognised new layout", () => {
  assert.equal(
    classifySoldPageState({
      url: "https://www.ebay.com.au/sch/i.html",
      title: "sony wh-1000xm5 | eBay",
      legacyCards: 0,
      newLayoutCards: 30,
      hasZeroResultsMarker: false,
    }),
    "unsupported",
  );
});

test("classifySoldPageState assumes a block when the page is unrecognisable", () => {
  assert.equal(
    classifySoldPageState({
      url: "https://www.ebay.com.au/sch/i.html",
      title: "eBay",
      legacyCards: 0,
      newLayoutCards: 0,
      hasZeroResultsMarker: false,
    }),
    "blocked",
  );
});

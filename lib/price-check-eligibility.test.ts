import assert from "node:assert/strict";
import test from "node:test";
import {
  getPriceCheckEligibility,
  getPriceCheckPrerequisiteIssue,
  getSelectedPriceCheckSummary,
} from "@/lib/price-check-eligibility";

test("missing ASIN is ineligible instead of becoming a failed check", () => {
  const product = {
    id: "missing-asin",
    status: "IMPORTED",
    asin: null,
    _count: { variants: 1 },
  };

  assert.equal(getPriceCheckPrerequisiteIssue(product), "missing-asin");
  assert.deepEqual(getPriceCheckEligibility(product), {
    eligible: false,
    reason: "missing-asin",
    message:
      "Selected product cannot be price checked because its Amazon ASIN is missing or invalid.",
  });
});

test("invalid ASIN is skipped as an unmet prerequisite", () => {
  const product = {
    id: "invalid-asin",
    status: "IMPORTED",
    asin: "NOT-AN-ASIN",
    _count: { variants: 1 },
  };

  assert.equal(getPriceCheckPrerequisiteIssue(product), "missing-asin");
  assert.equal(getPriceCheckEligibility(product).eligible, false);
});

test("missing variants are ineligible", () => {
  const product = {
    id: "missing-variants",
    status: "IMPORTED",
    asin: "B07VJ5LG19",
    _count: { variants: 0 },
  };

  assert.equal(getPriceCheckPrerequisiteIssue(product), "missing-variants");
  assert.equal(getPriceCheckEligibility(product).eligible, false);
  assert.equal(getPriceCheckEligibility(product).reason, "missing-variants");
});

test("mixed selection checks tracked products and reports skipped reasons", () => {
  const products = [
    {
      id: "tracked",
      status: "IMPORTED",
      asin: "B07VJ5LG19",
      _count: { variants: 1 },
    },
    {
      id: "missing-asin",
      status: "IMPORTED",
      asin: null,
      _count: { variants: 1 },
    },
    {
      id: "missing-variants",
      status: "IMPORTED",
      asin: "B0FBZZPQQG",
      _count: { variants: 0 },
    },
  ];

  const summary = getSelectedPriceCheckSummary(
    products,
    products.map((product) => product.id),
  );

  assert.deepEqual(summary.eligibleIds, ["tracked"]);
  assert.equal(summary.ineligibleCount, 2);
  assert.equal(summary.reasonCounts["missing-asin"], 1);
  assert.equal(summary.reasonCounts["missing-variants"], 1);
  assert.equal(
    summary.message,
    "Checking 1 selected product. Skipping 2: 1 missing ASIN, 1 missing variant.",
  );
});

test("selection with only missing ASINs queues no products", () => {
  const products = [
    {
      id: "one",
      status: "IMPORTED",
      asin: null,
      variants: [{}],
    },
    {
      id: "two",
      status: "IMPORTED",
      asin: " ",
      variants: [{}],
    },
  ];
  const summary = getSelectedPriceCheckSummary(products, ["one", "two"]);

  assert.deepEqual(summary.eligibleIds, []);
  assert.equal(
    summary.message,
    "None of the selected products can be price checked: 2 missing ASINs.",
  );
});

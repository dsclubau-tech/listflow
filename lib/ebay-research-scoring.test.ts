import assert from "node:assert/strict";
import test from "node:test";
import { scoreEbayResearchResultForQuery } from "@/lib/ebay-research-scoring";

const cookwareQuery =
  "Pots and Pans Set Non Stick, Nonstick Detachable Handle Cookware Sets,";

test("research match scoring gives the exact cookware search a perfect match", () => {
  assert.equal(
    scoreEbayResearchResultForQuery(
      "Pots and Pans Set Non Stick, Nonstick Detachable Handle Cookware Sets",
      cookwareQuery,
    ),
    100,
  );
});

test("research match scoring treats non stick and nonstick as equivalent", () => {
  assert.ok(
    scoreEbayResearchResultForQuery(
      "Pots and Pans Set Non Stick Detachable Handle Cookware Sets",
      cookwareQuery,
    ) >= 90,
  );
  assert.ok(
    scoreEbayResearchResultForQuery(
      "Pots and Pans Set Nonstick Detachable Handle Cookware Sets",
      cookwareQuery,
    ) >= 90,
  );
});

test("research match scoring penalizes missing detachable handle and unrequested piece count", () => {
  assert.ok(
    scoreEbayResearchResultForQuery(
      "5PCS Pots and Pans Set Non Stick, Nonstick Cookware Set",
      cookwareQuery,
    ) < 60,
  );
});

test("research match scoring does not mark ceramic or piece-count variants as perfect", () => {
  assert.ok(
    scoreEbayResearchResultForQuery(
      "Ceramic Pots and Pans Set Non Stick, Nonstick Detachable Handle Cookware Sets",
      cookwareQuery,
    ) < 100,
  );
  assert.ok(
    scoreEbayResearchResultForQuery(
      "18 Piece Pots and Pans Set, Nonstick Detachable Handle Cookware Sets",
      cookwareQuery,
    ) < 90,
  );
});

test("research match scoring gives the exact Fitarc pull-up bar search a perfect match", () => {
  const title = "Fitarc Joist Mount Pull Up Bar Chin Up Bar Ceiling";

  assert.equal(scoreEbayResearchResultForQuery(title, title), 100);
});

const tabletQuery = "2 in 1 Tablet 10 Inch Android 14 OS Tableta";

test("research match scoring keeps rearranged tablet query tokens relevant", () => {
  assert.ok(
    scoreEbayResearchResultForQuery(
      "Android 14 Tableta 10 Inch 2 in 1 Tablet OS",
      tabletQuery,
    ) >= 60,
  );
});

test("research match scoring does not reject a tablet result missing standalone 1", () => {
  assert.ok(
    scoreEbayResearchResultForQuery(
      "Android 14 Tableta 10 Inch 2 Tablet OS",
      tabletQuery,
    ) >= 50,
  );
});

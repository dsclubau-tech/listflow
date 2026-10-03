import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AmazonPriceTrackingLabel from "../components/AmazonPriceTrackingLabel";
import type { AmazonPriceSelection } from "./amazon-price-selection";

const fallback: AmazonPriceSelection = {
  requestedMode: "DEAL", effectiveMode: "REGULAR", isFallback: true, observedAt: "2026-10-03T00:00:00Z",
};
const render = (mode: unknown, selection?: AmazonPriceSelection | null) =>
  renderToStaticMarkup(createElement(AmazonPriceTrackingLabel, { mode, selection }));

test("display retains Deal preference and explains Regular fallback", () => {
  const markup = render("DEAL", fallback);
  assert.match(markup, /Deal price/);
  assert.match(markup, /Using Regular Price temporarily/);
});

test("returning deals, failed checks, and older responses do not display fallback", () => {
  for (const selection of [undefined, null, { ...fallback, effectiveMode: "DEAL" as const, isFallback: false }]) {
    const markup = render("DEAL", selection);
    assert.match(markup, /Deal price/);
    assert.doesNotMatch(markup, /temporarily/);
  }
  assert.doesNotMatch(render("REGULAR", fallback), /temporarily/);
  assert.match(render(undefined), /Regular price/);
});

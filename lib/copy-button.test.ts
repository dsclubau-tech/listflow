import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CopyButton from "@/components/ui/CopyButton";

test("CopyButton renders accessible button with default copy icon and title", () => {
  const markup = renderToStaticMarkup(
    createElement(CopyButton, { text: "B07VJ5LG19" }),
  );

  assert.match(markup, /type="button"/);
  assert.match(markup, /title="Copy"/);
  assert.match(markup, /aria-label="Copy"/);
  assert.match(markup, /<svg/);
  assert.match(markup, /h-3\.5 w-3\.5/);
});

test("CopyButton respects custom label and size", () => {
  const markup = renderToStaticMarkup(
    createElement(CopyButton, {
      text: "B07VJ5LG19",
      label: "Copy ASIN",
      size: "sm",
    }),
  );

  assert.match(markup, /title="Copy ASIN"/);
  assert.match(markup, /aria-label="Copy ASIN"/);
  assert.match(markup, /h-4 w-4/);
  assert.match(markup, /p-1/);
});

test("DraftsTable integrates CopyButton for ASIN and eBay Item ID", () => {
  const source = readFileSync("components/DraftsTable.tsx", "utf8");

  assert.match(source, /import CopyButton from "@\/components\/ui\/CopyButton"/);
  assert.match(source, /<CopyButton text=\{asin\.toUpperCase\(\)\} label="Copy ASIN" \/>/);
  assert.match(source, /<CopyButton text=\{ebayItemId\} label="Copy eBay Item ID" \/>/);
  assert.match(source, /<CopyButton\s+text=\{product\.asin\.toUpperCase\(\)\}\s+label="Copy ASIN"/);
  assert.match(source, /<CopyButton\s+text=\{product\.ebayItemId\}\s+label="Copy eBay Item ID"/);
});

test("ProductVariantsPanel integrates CopyButton for variant SKU", () => {
  const source = readFileSync("components/ProductVariantsPanel.tsx", "utf8");

  assert.match(source, /import CopyButton from "@\/components\/ui\/CopyButton"/);
  assert.match(source, /<CopyButton text=\{variant\.sku\} label="Copy SKU" \/>/);
});

test("ProductVariantsEditor integrates CopyButton for variant SKU", () => {
  const source = readFileSync("components/ProductVariantsEditor.tsx", "utf8");

  assert.match(source, /import CopyButton from "@\/components\/ui\/CopyButton"/);
  assert.match(source, /<CopyButton text=\{variant\.sku\} label="Copy SKU" \/>/);
});

test("AsinLink supports optional showCopyButton prop", () => {
  const source = readFileSync("components/AsinLink.tsx", "utf8");

  assert.match(source, /showCopyButton\?: boolean/);
  assert.match(source, /showCopyButton && \(/);
  assert.match(source, /<CopyButton/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("description editors opt into a responsive sticky formatting toolbar", () => {
  const editor = readFileSync("components/RichTextEditor.tsx", "utf8");
  const inlineEditor = readFileSync("components/InlineEditForm.tsx", "utf8");
  const draftEditor = readFileSync("components/DraftEditForm.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");

  assert.match(editor, /stickyToolbar\?: boolean/);
  assert.match(editor, /data-toolbar-sticky=/);
  assert.match(inlineEditor, /selectableImages\s+stickyToolbar/);
  assert.match(draftEditor, /onChange=\{setDescription\}\s+stickyToolbar/);
  assert.match(
    styles,
    /\[data-toolbar-sticky="true"\] \.listflow-quill-toolbar/,
  );
  assert.match(styles, /top: 4rem/);
  assert.match(styles, /@media \(min-width: 768px\)/);
});

test("inline editor preloads variants and retains mounted tab state", () => {
  const source = readFileSync("components/InlineEditForm.tsx", "utf8");

  assert.match(source, /new Set\(\[0, 2\]\)/);
  assert.match(source, /mountedTabs\.has\(2\)/);
  assert.match(source, /hidden=\{activeTab !== 2\}/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /<ProductVariantsPanel/);
  assert.doesNotMatch(source, /<ProductVariantsEditor/);
  assert.doesNotMatch(source, /\+ Add Variant/);
});

test("active variants panel caches requests and exposes edit-only controls", () => {
  const source = readFileSync("components/ProductVariantsPanel.tsx", "utf8");

  assert.match(source, /const variantCache = new Map/);
  assert.match(source, /const variantRequests = new Map/);
  assert.match(source, /variantRequests\.get\(productId\)/);
  assert.match(source, /isOpen=\{editingVariant !== null\}/);
  assert.match(source, />\s*Edit\s*</);
  assert.match(source, /"Deleting\.\.\." : "Delete"/);
  assert.doesNotMatch(source, /Add Variant/);
  assert.doesNotMatch(source, /router\.refresh/);
});

test("variants endpoint returns existing rows before creating a fallback", () => {
  const source = readFileSync(
    "app/api/products/[id]/variants/route.ts",
    "utf8",
  );
  const firstRead = source.indexOf("let variants = await prisma.variant.findMany");
  const emptyFallback = source.indexOf("if (variants.length === 0)");
  const ensureFallback = source.indexOf(
    "await ensureDefaultVariantForProduct(productId)",
  );

  assert.ok(firstRead >= 0);
  assert.ok(emptyFallback > firstRead);
  assert.ok(ensureFallback > emptyFallback);
});

test("new drafts create their default variant in the product transaction", () => {
  const source = readFileSync("app/api/products/route.ts", "utf8");

  assert.match(source, /import \{ buildDefaultVariantData \}/);
  assert.match(source, /const createdProduct = await tx\.product\.create/);
  assert.match(source, /await tx\.variant\.create/);
  assert.match(source, /data: buildDefaultVariantData/);
});

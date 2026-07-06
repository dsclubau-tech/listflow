import assert from "node:assert/strict";
import test from "node:test";
import { removeImportedDraftProduct } from "@/lib/draft-products-state";

test("removeImportedDraftProduct removes the imported draft immediately", () => {
  const products = [
    { id: "draft-1", title: "First draft" },
    { id: "draft-2", title: "Imported draft" },
    { id: "draft-3", title: "Third draft" },
  ];

  assert.deepEqual(removeImportedDraftProduct(products, "draft-2"), [
    { id: "draft-1", title: "First draft" },
    { id: "draft-3", title: "Third draft" },
  ]);
});

test("removeImportedDraftProduct leaves the list unchanged when product is absent", () => {
  const products = [{ id: "draft-1", title: "First draft" }];

  assert.deepEqual(removeImportedDraftProduct(products, "missing"), products);
});

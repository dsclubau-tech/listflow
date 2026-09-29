import assert from "node:assert/strict";
import test from "node:test";
import { createDraftFromScrapedProduct } from "@/components/draft-autosave";
import type { ScrapedProduct } from "@/components/AddProductModal";

test("draft autosave sends the selected suburb and product postcode separately", async () => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "test-draft" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const product: ScrapedProduct = {
      title: "Test product", description: "Amazon product description", images: ["https://m.media-amazon.com/images/I/test.jpg"],
      price: 25, condition: "New", category: "", categoryId: "", categoryName: "",
      itemSpecifics: { Brand: "Example" }, variantName: null, asin: "B0TEST1234", brand: "Example",
      supplierDefaults: {
        quantity: 1, country: "Australia", zipcode: "3175", locationText: "Dandenong North, VIC",
        shippingMethod: "Cheapest with tracking", storeNumber: 1,
        shippingPolicyId: null, paymentPolicyId: null, returnPolicyId: null, policyTemplateId: null,
        capitalizeTitle: false, defaultItemSpecifics: { _Location: "Bangholme, VIC" },
      },
    };
    await createDraftFromScrapedProduct(product);
    const specifics = (payload as { itemSpecifics: Record<string, string> } | null)?.itemSpecifics;
    assert.equal(specifics?._Country, "AU");
    assert.equal(specifics?._PostalCode, "3175");
    assert.equal(specifics?._Location, "Dandenong North, VIC");
    assert.equal(specifics?.Brand, "Example");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

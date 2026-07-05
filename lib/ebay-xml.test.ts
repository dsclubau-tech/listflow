import assert from "node:assert/strict";
import test from "node:test";
import { buildAddItemXML } from "@/lib/ebay-xml";

function buildTestProduct() {
  return {
    title: "Test listing",
    description: "Test description",
    price: 12.34,
    quantity: 1,
    category: "12345",
    categoryName: "Test Category",
    condition: "New",
    images: ["https://example.com/image.jpg"],
    itemSpecifics: {
      Brand: "Test Brand",
      _Country: "AU",
      _Currency: "AUD",
      _Site: "Australia",
      _Location: "Australia",
      _PostalCode: "3000",
    },
    shippingPolicyId: "shipping-1",
    returnPolicyId: "return-1",
    paymentPolicyId: "payment-1",
  } as Parameters<typeof buildAddItemXML>[0];
}

test("buildAddItemXML sends custom label as eBay SKU", () => {
  const xml = buildAddItemXML(buildTestProduct(), undefined, {
    customLabel: "B07VJ5LG19",
  });

  assert.match(xml, /<SKU>B07VJ5LG19<\/SKU>/);
});


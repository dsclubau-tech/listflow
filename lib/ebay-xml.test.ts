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

test("buildAddItemXML caps eBay title without changing description", () => {
  const longTitle =
    "ZipString Aracna Glow-in-The-Dark Webshooter - Superhero String Launcher Toy for Kids, Teens & Adults - Patented, Reloading, Durable & Viral Web Shooting Action Toy";
  const product = {
    ...buildTestProduct(),
    title: longTitle,
    description: `<h2>${longTitle}</h2>`,
  };

  const xml = buildAddItemXML(product);
  const titleMatch = xml.match(/<Title>([^<]+)<\/Title>/);

  assert.ok(titleMatch);
  assert.equal(titleMatch[1].length <= 80, true);
  assert.match(xml, /Superhero String Launcher Toy/);
});

test("buildAddItemXML keeps required item specifics when trimming", () => {
  const product = {
    ...buildTestProduct(),
    itemSpecifics: {
      Brand: "Test Brand",
      MPN: "Does not apply",
      Model: "Model 1",
      Colour: "White",
      Material: "Polyester",
      Type: "Wedge Pillow",
      Size: "Queen",
      Features: "Adjustable",
      _Country: "AU",
      _Currency: "AUD",
      _Site: "Australia",
      _Location: "Australia",
      _PostalCode: "3000",
    },
  };
  const xml = buildAddItemXML(product, undefined, {
    itemSpecificMaxCount: 4,
    requiredItemSpecificNames: ["Size", "Type"],
  });

  assert.match(xml, /<Name>Size<\/Name>\s*<Value>Queen<\/Value>/);
  assert.match(xml, /<Name>Type<\/Name>\s*<Value>Wedge Pillow<\/Value>/);
});

test("buildAddItemXML repairs country-only item location from postcode", () => {
  const product = {
    ...buildTestProduct(),
    itemSpecifics: {
      Brand: "Test Brand",
      _Country: "Australia",
      _Currency: "AUD",
      _Site: "Australia",
      _Location: "Australia",
      _PostalCode: "3170",
    },
  };
  const xml = buildAddItemXML(product);

  assert.match(xml, /<Country>AU<\/Country>/);
  assert.match(xml, /<Location>Mulgrave, VIC<\/Location>/);
  assert.match(xml, /<PostalCode>3170<\/PostalCode>/);
  assert.doesNotMatch(xml, /<Location>Australia<\/Location>/);
});

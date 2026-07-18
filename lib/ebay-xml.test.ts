import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAddItemXML,
  buildGetSellerListIdsXML,
  buildReviseInventoryStatusXML,
  buildReviseItemXML,
} from "@/lib/ebay-xml";

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

test("buildReviseItemXML sends the edited eBay listing title", () => {
  const editedTitle =
    "Nail Dust Collector, Compact Vacuum Fan Dust Collector for Beginner";
  const product = {
    ...buildTestProduct(),
    title: editedTitle,
    fullTitle:
      "MelodySusie Nail Dust Collector, Compact Vacuum Fan Dust Collector for Beginner",
    ebayItemId: "307056203187",
  } as Parameters<typeof buildReviseItemXML>[0];

  const xml = buildReviseItemXML(product);

  assert.match(xml, new RegExp(`<Title>${editedTitle}<\\/Title>`));
  assert.doesNotMatch(xml, /<Title>MelodySusie/);
});

test("buildReviseItemXML omits pictures unless explicitly requested", () => {
  const product = {
    ...buildTestProduct(),
    ebayItemId: "307056203187",
  } as Parameters<typeof buildReviseItemXML>[0];

  assert.doesNotMatch(buildReviseItemXML(product), /<PictureDetails>/);
});

test("buildReviseItemXML sends the complete ordered picture replacement", () => {
  const product = {
    ...buildTestProduct(),
    ebayItemId: "307056203187",
    images: [
      "https://i.ebayimg.com/images/g/main/s-l1600.jpg?ignored=1",
      "https://i.ebayimg.com/images/g/second&copy/s-l1600.jpg",
      "https://i.ebayimg.com/images/g/main/s-l1600.jpg",
    ],
  } as Parameters<typeof buildReviseItemXML>[0];

  const xml = buildReviseItemXML(product, undefined, {
    includePictures: true,
  });
  const pictureUrls = Array.from(
    xml.matchAll(/<PictureURL>(.*?)<\/PictureURL>/g),
    (match) => match[1],
  );

  assert.deepEqual(pictureUrls, [
    "https://i.ebayimg.com/images/g/main/s-l1600.jpg",
    "https://i.ebayimg.com/images/g/second&amp;copy/s-l1600.jpg",
  ]);
});

test("buildReviseItemXML rejects more than 24 listing pictures", () => {
  const product = {
    ...buildTestProduct(),
    ebayItemId: "307056203187",
    images: Array.from(
      { length: 25 },
      (_, index) => `https://i.ebayimg.com/images/g/${index}/s-l1600.jpg`,
    ),
  } as Parameters<typeof buildReviseItemXML>[0];

  assert.throws(
    () =>
      buildReviseItemXML(product, undefined, {
        includePictures: true,
      }),
    /up to 24 listing images/,
  );
});

test("buildReviseInventoryStatusXML sends a single quantity of zero", () => {
  const xml = buildReviseInventoryStatusXML("307056203187", { quantity: 0 });

  assert.match(xml, /<ReviseInventoryStatusRequest/);
  assert.match(xml, /<ItemID>307056203187<\/ItemID>/);
  assert.match(xml, /<Quantity>0<\/Quantity>/);
  assert.doesNotMatch(xml, /<StartPrice>/);
});

test("buildReviseInventoryStatusXML sends price-only inventory updates", () => {
  const xml = buildReviseInventoryStatusXML("307056203187", {
    startPrice: 18.5,
  });

  assert.match(xml, /<StartPrice>18\.50<\/StartPrice>/);
  assert.doesNotMatch(xml, /<Quantity>/);
});

test("buildReviseInventoryStatusXML sends mixed multi-item inventory updates", () => {
  const xml = buildReviseInventoryStatusXML([
    { ebayItemId: "1001", quantity: 0 },
    { ebayItemId: "1002", startPrice: "12.3" },
    { ebayItemId: "1003", startPrice: 14, quantity: 7 },
  ]);

  assert.equal((xml.match(/<InventoryStatus>/g) ?? []).length, 3);
  assert.match(
    xml,
    /<ItemID>1001<\/ItemID>\s*<Quantity>0<\/Quantity>/,
  );
  assert.match(
    xml,
    /<ItemID>1002<\/ItemID>\s*<StartPrice>12\.30<\/StartPrice>/,
  );
  assert.match(
    xml,
    /<ItemID>1003<\/ItemID>\s*<StartPrice>14\.00<\/StartPrice>\s*<Quantity>7<\/Quantity>/,
  );
});

test("buildReviseInventoryStatusXML rejects more than four inventory updates", () => {
  assert.throws(
    () =>
      buildReviseInventoryStatusXML([
        { ebayItemId: "1001", quantity: 1 },
        { ebayItemId: "1002", quantity: 1 },
        { ebayItemId: "1003", quantity: 1 },
        { ebayItemId: "1004", quantity: 1 },
        { ebayItemId: "1005", quantity: 1 },
      ]),
    /up to 4 items/,
  );
});

test("buildGetSellerListIdsXML requests SKU, variation SKU, and listing start time", () => {
  const xml = buildGetSellerListIdsXML(1);

  assert.match(xml, /<DetailLevel>ReturnSummary<\/DetailLevel>/);
  assert.match(xml, /<IncludeVariations>true<\/IncludeVariations>/);
  assert.match(xml, /<OutputSelector>SKU<\/OutputSelector>/);
  assert.match(xml, /<OutputSelector>Variations<\/OutputSelector>/);
  assert.match(xml, /<OutputSelector>ListingDetails<\/OutputSelector>/);
  assert.match(xml, /<OutputSelector>StartTime<\/OutputSelector>/);
});

import assert from "node:assert/strict";
import Module from "node:module";
import test, { type TestContext } from "node:test";
import { load } from "cheerio";
import {
  extractAmazonPostcodeToken,
  extractAmazonProductTitle,
  parseAmazonPostcodeResponse,
} from "@/lib/amazon-direct-parse";

const moduleWithLoad = Module as unknown as {
  _load: (
    request: string,
    parent?: unknown,
    isMain?: boolean
  ) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;

moduleWithLoad._load = function loadWithServerOnlyShim(
  this: unknown,
  request: string,
  parent?: unknown,
  isMain?: boolean
) {
  if (request === "server-only") {
    return {};
  }

  return originalModuleLoad.call(this, request, parent, isMain);
};

type AmazonDirectScraperModule = typeof import("@/lib/amazon-direct-scraper");

let amazonDirectScraperModule: Promise<AmazonDirectScraperModule> | null = null;

function loadAmazonDirectScraper() {
  amazonDirectScraperModule ??= import("@/lib/amazon-direct-scraper");
  return amazonDirectScraperModule;
}

const originalFetch = globalThis.fetch;

function amazonProductHtml(input: {
  title?: string;
  buyboxPrice?: string | null;
  dealPrice?: string | null;
  regularPrice?: string | null;
  pageWidePrice?: string | null;
  postcode?: string | null;
}) {
  const deliveryLocation = input.postcode
    ? `<div id="glow-ingress-line1">Deliver to RK</div><div id="glow-ingress-line2">Kogarah ${input.postcode}</div>`
    : `<div id="glow-ingress-line1">Deliver to RK</div>`;
  const buybox = input.buyboxPrice
    ? `<div id="corePrice_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">${input.buyboxPrice}</span></span></div>`
    : input.dealPrice || input.regularPrice
    ? `<div id="corePrice_feature_div">
        ${
          input.dealPrice
            ? `<div><span>Deal price</span><span class="a-price priceToPay"><span class="a-offscreen">${input.dealPrice}</span></span></div>`
            : ""
        }
        ${
          input.regularPrice
            ? `<div><span>Regular Price</span><span class="a-price"><span class="a-offscreen">${input.regularPrice}</span></span></div>`
            : ""
        }
      </div>`
    : "";
  const pageWide = input.pageWidePrice
    ? `<section class="recommendation"><span class="a-price"><span class="a-offscreen">${input.pageWidePrice}</span></span></section>`
    : "";

  return `
    <html>
      <head>
        <meta property="og:title" content="${input.title ?? "SOUNDPEATS H3 Cancelling Headphones"} : Amazon.com.au: Electronics" />
        <meta property="og:image" content="https://m.media-amazon.com/images/I/test-image.jpg" />
      </head>
      <body>
        ${deliveryLocation}
        <input id="ASIN" value="B0TEST1234" />
        <img id="landingImage" src="https://m.media-amazon.com/images/I/test-image.jpg" />
        ${pageWide}
        ${buybox}
      </body>
    </html>
  `;
}

function installFetchMock(
  t: TestContext,
  responses: Array<{ body: string; status?: number; headers?: HeadersInit }>
) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input, init) => {
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected fetch call to ${String(input)}`);
    }

    calls.push({ input, init });
    return new Response(response.body, {
      status: response.status ?? 200,
      headers: response.headers,
    });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  return calls;
}

test("extractAmazonProductTitle reads meta content when text title is missing", () => {
  const $ = load(`
    <html>
      <head>
        <meta property="og:title" content="SoundPEATS Air5 Pro Cancelling Earbuds : Amazon.com.au: Electronics" />
      </head>
      <body></body>
    </html>
  `);

  assert.equal(
    extractAmazonProductTitle($),
    "SoundPEATS Air5 Pro Cancelling Earbuds"
  );
});

test("scrapeAmazonProductDirect uses selected Amazon price tracking mode", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();

  installFetchMock(t, [
    {
      body: amazonProductHtml({
        dealPrice: "$63.99",
        regularPrice: "$79.99",
      }),
    },
    { body: '{"isValidAddress":1}' },
    {
      body: amazonProductHtml({
        dealPrice: "$63.99",
        regularPrice: "$79.99",
        postcode: "2217",
      }),
    },
  ]);

  const product = await scrapeAmazonProductDirect(
    "https://www.amazon.com.au/dp/B0TEST1234",
    {
      postcode: "2217",
      priceTrackingMode: "DEAL",
    }
  );

  assert.equal(product.price, 63.99);
  assert.equal(product.amazonPriceTrackingMode, "DEAL");
  assert.equal(product.priceChoices?.regular?.price, 79.99);
  assert.equal(product.priceChoices?.deal?.price, 63.99);
});

test("scrapeAmazonProductDirect keeps full Amazon title separately from eBay listing title", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();
  const longTitle =
    "ZipString Aracna Glow-in-The-Dark Webshooter - Superhero String Launcher Toy for Kids, Teens & Adults - Patented, Reloading, Durable & Viral Web Shooting Action Toy";

  installFetchMock(t, [
    {
      body: amazonProductHtml({
        title: longTitle,
        buyboxPrice: "$89.59",
      }),
    },
    { body: '{"isValidAddress":1}' },
    {
      body: amazonProductHtml({
        title: longTitle,
        buyboxPrice: "$89.59",
        postcode: "2217",
      }),
    },
  ]);

  const product = await scrapeAmazonProductDirect(
    "https://www.amazon.com.au/dp/B0TEST1234",
    { postcode: "2217" }
  );

  assert.equal(product.fullTitle, longTitle);
  assert.equal(product.title.length <= 80, true);
  assert.notEqual(product.title, product.fullTitle);
  assert.match(product.description, /Superhero String Launcher Toy/);
});

test("extractAmazonProductTitle reads product JSON-LD title", () => {
  const $ = load(`
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Wireless Earbuds with Case"}
    </script>
  `);

  assert.equal(extractAmazonProductTitle($), "Wireless Earbuds with Case");
});

test("parseAmazonPostcodeResponse accepts JSON and text success shapes", () => {
  assert.equal(
    parseAmazonPostcodeResponse('{"isValidAddress":"1"}', "2217"),
    true
  );
  assert.equal(
    parseAmazonPostcodeResponse('{"address":{"postalCode":"2217"}}', "2217"),
    true
  );
  assert.equal(parseAmazonPostcodeResponse('{"isValidAddress":0}', "2217"), false);
});

test("extractAmazonPostcodeToken reads hidden and scripted csrf tokens", () => {
  const hidden = load(
    '<input name="anti-csrftoken-a2z" value="hidden-token" />'
  );
  const scripted = load("<html></html>");

  assert.equal(extractAmazonPostcodeToken(hidden), "hidden-token");
  assert.equal(
    extractAmazonPostcodeToken(
      scripted,
      'window.csrfToken = "script-token";'
    ),
    "script-token"
  );
});

test("verifyAmazonDeliveryPostcode detects visible AU postcode location", () => {
  return loadAmazonDirectScraper().then(({ verifyAmazonDeliveryPostcode }) => {
    assert.equal(
      verifyAmazonDeliveryPostcode(
        amazonProductHtml({ buyboxPrice: "$129.99", postcode: "2217" }),
        "2217"
      ),
      true
    );
    assert.equal(
      verifyAmazonDeliveryPostcode(
        amazonProductHtml({ buyboxPrice: "$129.99" }),
        "2217"
      ),
      false
    );
  });
});

test("scrapeAmazonProductDirect proceeds when postcode response is ambiguous but refetched buybox is safe", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();
  const calls = installFetchMock(t, [
    { body: amazonProductHtml({ buyboxPrice: "$98.00" }) },
    { body: '{"isValidAddress":0}' },
    { body: '{"isValidAddress":0}' },
    { body: amazonProductHtml({ buyboxPrice: "$129.99", postcode: "2217" }) },
  ]);
  const stages: Array<{
    metadata?: Record<string, unknown>;
    stage: string;
  }> = [];

  const product = await scrapeAmazonProductDirect(
    "https://www.amazon.com.au/dp/B0TEST1234",
    {
      postcode: "2217",
      onStage: (stage, _durationMs, metadata) => {
        stages.push({ stage, metadata });
      },
    }
  );

  assert.equal(product.price, 129.99);
  assert.equal(calls.length, 4);
  assert.match(
    String(calls[1].input),
    /\/gp\/delivery\/ajax\/address-change\.html$/
  );

  const postcodeStage = stages.find((entry) => entry.stage === "postcode_set");
  assert.equal(postcodeStage?.metadata?.responseConfirmed, false);

  const priceStage = stages.find((entry) => entry.stage === "price_extract");
  assert.equal(priceStage?.metadata?.postcodeVerified, true);
  assert.equal(priceStage?.metadata?.postcodeApplied, true);
});

test("scrapeAmazonProductDirect fails when only page-wide prices exist after postcode check", async (t) => {
  const { AmazonDirectScrapeError, scrapeAmazonProductDirect } =
    await loadAmazonDirectScraper();

  installFetchMock(t, [
    { body: amazonProductHtml({ pageWidePrice: "$98.00" }) },
    { body: '{"isValidAddress":0}' },
    { body: '{"isValidAddress":0}' },
    {
      body: amazonProductHtml({
        pageWidePrice: "$98.00",
        postcode: "2217",
      }),
    },
  ]);

  await assert.rejects(
    scrapeAmazonProductDirect("https://www.amazon.com.au/dp/B0TEST1234", {
      postcode: "2217",
    }),
    (error) => {
      assert.equal(error instanceof AmazonDirectScrapeError, true);
      assert.equal(
        (error as AmazonDirectScrapeError).code,
        "AMAZON_BUYBOX_PRICE_MISSING"
      );
      return true;
    }
  );
});

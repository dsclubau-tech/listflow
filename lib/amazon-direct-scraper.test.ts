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
  imageScript?: string | null;
  descriptionHtml?: string | null;
  detailsHtml?: string | null;
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
        ${input.imageScript ?? ""}
        ${pageWide}
        ${buybox}
        ${input.detailsHtml ?? ""}
        ${
          input.descriptionHtml ??
          `<div id="feature-bullets"><ul><li><span>${
            input.title ?? "Reliable selected-product details"
          }</span></li></ul></div>`
        }
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

test("extractAmazonProductTitle reads the document title for alternate Amazon markup", () => {
  const $ = load(`
    <html>
      <head>
        <title>KNQZE Shiatsu Cordless Neck Massager : Amazon.com.au: Health, Household &amp; Personal Care</title>
      </head>
      <body></body>
    </html>
  `);

  assert.equal(
    extractAmazonProductTitle($),
    "KNQZE Shiatsu Cordless Neck Massager"
  );
});

test("extractAmazonProductTitle rejects generic Amazon document titles", () => {
  const $ = load("<html><head><title>Amazon.com.au</title></head></html>");

  assert.equal(extractAmazonProductTitle($), "");
});

test("Amazon URL variants resolve to the same normalized ASIN", async () => {
  const { extractAmazonAsinFromValue } = await loadAmazonDirectScraper();

  assert.equal(
    extractAmazonAsinFromValue("https://www.amazon.com.au/dp/b0test1234?tag=example"),
    "B0TEST1234",
  );
  assert.equal(
    extractAmazonAsinFromValue(
      "https://www.amazon.com.au/gp/product/B0TEST1234/ref=something",
    ),
    "B0TEST1234",
  );
  assert.equal(
    extractAmazonAsinFromValue(
      "https://www.amazon.com.au/example/product?asin=B0TEST1234",
    ),
    "B0TEST1234",
  );
});

test("scrapeAmazonProductDirect retries once when the initial page has no product title", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();
  const calls = installFetchMock(t, [
    {
      body: "<html><head><title>Amazon.com.au</title></head><body>Temporary response</body></html>",
    },
    {
      body: amazonProductHtml({
        title: "KNQZE Shiatsu Cordless Neck Massager",
        buyboxPrice: "$119.99",
      }),
    },
    { body: '{"isValidAddress":1}' },
    {
      body: amazonProductHtml({
        title: "KNQZE Shiatsu Cordless Neck Massager",
        buyboxPrice: "$119.99",
        postcode: "2217",
      }),
    },
  ]);

  const product = await scrapeAmazonProductDirect(
    "https://www.amazon.com.au/dp/B0GWM5MWXX",
    { postcode: "2217" }
  );

  assert.equal(product.fullTitle, "KNQZE Shiatsu Cordless Neck Massager");
  assert.equal(product.price, 119.99);
  assert.equal(calls.length, 4);
  assert.match(String(calls[1]?.input), /\?th=1&psc=1$/);
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

test("scrapeAmazonProductDirect stores parsed package dimensions as hidden specifics", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();
  const detailsHtml = `
    <table id="productDetails_techSpec_section_1">
      <tr><th>Item Weight</th><td>2 pounds</td></tr>
      <tr><th>Product Dimensions</th><td>12 x 8 x 4 inches</td></tr>
    </table>
  `;

  installFetchMock(t, [
    {
      body: amazonProductHtml({
        buyboxPrice: "$89.59",
        detailsHtml,
      }),
    },
    { body: '{"isValidAddress":1}' },
    {
      body: amazonProductHtml({
        buyboxPrice: "$89.59",
        postcode: "2217",
        detailsHtml,
      }),
    },
  ]);

  const product = await scrapeAmazonProductDirect(
    "https://www.amazon.com.au/dp/B0TEST1234",
    { postcode: "2217" },
  );

  assert.equal(product.itemSpecifics._WeightKg, "0");
  assert.equal(product.itemSpecifics._WeightG, "908");
  assert.equal(product.itemSpecifics._LengthCm, "30.48");
  assert.equal(product.itemSpecifics._WidthCm, "20.32");
  assert.equal(product.itemSpecifics._HeightCm, "10.16");
});

test("scrapeAmazonPackageItemSpecificsDirect fetches package data in one request", async (t) => {
  const { scrapeAmazonPackageItemSpecificsDirect } = await loadAmazonDirectScraper();
  const calls = installFetchMock(t, [
    {
      body: amazonProductHtml({
        detailsHtml: `
          <table id="productDetails_techSpec_section_1">
            <tr><th>Package Weight</th><td>1.25 kg</td></tr>
            <tr><th>Package Dimensions</th><td>50 x 30 x 12 cm</td></tr>
          </table>
        `,
      }),
    },
  ]);

  const itemSpecifics = await scrapeAmazonPackageItemSpecificsDirect(
    "https://www.amazon.com.au/dp/B0TEST1234",
  );

  assert.equal(calls.length, 1);
  assert.equal(itemSpecifics._WeightKg, "1");
  assert.equal(itemSpecifics._WeightG, "250");
  assert.equal(itemSpecifics._LengthCm, "50");
  assert.equal(itemSpecifics._WidthCm, "30");
  assert.equal(itemSpecifics._HeightCm, "12");
});

test("renderAmazonDescription keeps About bullets then Product Description A+ content and stops before Product Information", async () => {
  const { renderAmazonDescription } = await loadAmazonDirectScraper();
  const $ = load(`
    <div id="feature-bullets">
      <ul>
        <li><span><strong>VA panel</strong> Deep blacks and bright areas.</span></li>
        <li class="aok-hidden"><span>Hidden bullet</span></li>
      </ul>
      <a>See more product details</a>
    </div>
    <div id="productDescription"><p>Standard product description.</p></div>
    <div id="aplus_feature_div">
      <div id="aplus">
        <div class="aplus-module">
          <h3>Office Monitor</h3>
          <img
            src="https://m.media-amazon.com/images/I/monitor-small._AC_SX300_.jpg"
            data-a-hires="https://m.media-amazon.com/images/I/monitor-large._AC_SL1500_.jpg"
            alt="Office monitor"
          />
          <p>Capturing every detail.</p>
          <img
            srcset="https://m.media-amazon.com/images/I/detail-small._AC_SX300_.jpg 300w, https://m.media-amazon.com/images/I/detail-large._AC_SL1500_.jpg 1500w"
            alt="Monitor details"
          />
        </div>
      </div>
    </div>
    <section id="productDetails"><h2>Product information</h2><p>Must not be copied.</p></section>
    <section id="reviewsMedley"><p>Customer review text.</p></section>
  `);

  const description = renderAmazonDescription($);
  const aboutIndex = description.indexOf("About this item");
  const bulletIndex = description.indexOf("<strong>VA panel</strong>");
  const productDescriptionIndex = description.indexOf("Product Description");
  const standardIndex = description.indexOf("Standard product description.");
  const headingIndex = description.indexOf("Office Monitor");
  const firstImageIndex = description.indexOf("monitor-large.jpg");
  const aplusTextIndex = description.indexOf("Capturing every detail.");
  const secondImageIndex = description.indexOf("detail-large.jpg");

  assert.equal(aboutIndex >= 0, true);
  assert.equal(aboutIndex < bulletIndex, true);
  assert.equal(bulletIndex < productDescriptionIndex, true);
  assert.equal(productDescriptionIndex < standardIndex, true);
  assert.equal(standardIndex < headingIndex, true);
  assert.equal(headingIndex < firstImageIndex, true);
  assert.equal(firstImageIndex < aplusTextIndex, true);
  assert.equal(aplusTextIndex < secondImageIndex, true);
  assert.doesNotMatch(description, /Hidden bullet|See more product details/);
  assert.doesNotMatch(description, /Product information|Must not be copied|Customer review/);
});

test("renderAmazonDescription imports whichever requested Amazon section is available", async () => {
  const { renderAmazonDescription } = await loadAmazonDirectScraper();
  const aboutOnly = renderAmazonDescription(
    load('<div id="feature-bullets"><ul><li>Only bullet</li></ul></div>'),
  );
  const descriptionOnly = renderAmazonDescription(
    load('<div id="aplus"><p>Only A+ description</p></div>'),
  );

  assert.match(aboutOnly, /About this item/);
  assert.doesNotMatch(aboutOnly, /Product Description/);
  assert.match(descriptionOnly, /Product Description/);
  assert.doesNotMatch(descriptionOnly, /About this item/);
  assert.equal(renderAmazonDescription(load("<main>No source sections</main>")), "");
});

test("renderAmazonDescription excludes Amazon ratings and review containers", async () => {
  const { renderAmazonDescription } = await loadAmazonDirectScraper();
  const $ = load(`
    <div id="aplus">
      <h3>Product highlights</h3>
      <p>Useful product detail.</p>
      <span class="a-size-base">4.5 out of 5 stars 211</span>
      <span class="a-size-base">3.6 out of 5 stars 16</span>
      <span class="a-size-base">4.3 out of 5 stars</span>
      <div id="reviewFeatureGroup">
        <p>Review feature group content.</p>
      </div>
      <div id="averageCustomerReviews">
        <p>Average customer review content.</p>
      </div>
      <div id="customer-reviews">
        <p>Customer review content.</p>
      </div>
    </div>
  `);

  const description = renderAmazonDescription($);

  assert.match(description, /Product highlights/);
  assert.match(description, /Useful product detail/);
  assert.doesNotMatch(description, /out of 5 stars/i);
  assert.doesNotMatch(
    description,
    /Review feature group|Average customer review|Customer review content/i,
  );
});

test("renderAmazonDescription prefers Product Description over duplicate brand-story A+ and renders collapsed FAQs", async () => {
  const { renderAmazonDescription } = await loadAmazonDirectScraper();
  const $ = load(`
    <div id="aplusBrandStory_feature_div">
      <div id="aplus">
        <h3>From the brand</h3>
        <img
          src="https://m.media-amazon.com/images/I/brand-story._AC_SL1500_.jpg"
          alt="Brand story"
        />
      </div>
    </div>
    <div id="aplus_feature_div">
      <div id="aplus">
        <div class="aplus-module">
          <h3>Real product description</h3>
          <img
            src="https://images-na.ssl-images-amazon.com/images/G/01/x-locale/common/grey-pixel.gif"
            data-src="https://m.media-amazon.com/images/S/aplus-media-library-service-media/product-description.__CR0,0,2928,1200_PT0_SX1464_V1___.jpg"
            alt="Product details"
          />
          <img
            src="https://images-na.ssl-images-amazon.com/images/G/01/x-locale/common/grey-pixel.gif"
            alt=""
          />
          <ul class="aplus-carousel">
            <li>
              <img
                src="https://m.media-amazon.com/images/S/aplus-media-library-service-media/carousel-detail.__CR0,0,2928,1200_PT0_SX1464_V1___.jpg"
                alt="Carousel product detail"
              />
            </li>
          </ul>
          <div class="premium-module-11-faq">
            <ul class="faq-list">
              <li class="faq-block">
                <h3>
                  <span data-faq-question role="button" aria-expanded="false">
                    <p class="aplus-question">Does it require a subscription?</p>
                  </span>
                </h3>
                <p class="aplus-answer" style="visibility:hidden">
                  No, local storage and app features are included.
                </p>
              </li>
              <li class="faq-block">
                <h3>
                  <span data-faq-question role="button" aria-expanded="false">
                    <p class="aplus-question">Does it support dual-band Wi-Fi?</p>
                  </span>
                </h3>
                <p class="aplus-answer" style="display:none">
                  Yes, it supports both 2.4 GHz and 5 GHz networks.
                </p>
              </li>
            </ul>
            <script>window.initAmazonFaq()</script>
          </div>
        </div>
      </div>
    </div>
  `);

  const description = renderAmazonDescription($);
  const productImageIndex = description.indexOf(
    "aplus-media-library-service-media/product-description",
  );
  const faqIndex = description.indexOf("Frequently Asked Questions");

  assert.match(description, /Real product description/);
  assert.match(
    description,
    /aplus-media-library-service-media\/product-description/,
  );
  assert.match(description, /aplus-media-library-service-media\/carousel-detail/);
  assert.doesNotMatch(description, /From the brand|brand-story\.jpg/);
  assert.doesNotMatch(description, /grey-pixel\.gif/);
  assert.match(description, /Frequently Asked Questions/);
  assert.match(description, /Does it require a subscription\?/);
  assert.match(description, /No, local storage and app features are included\./);
  assert.match(description, /Does it support dual-band Wi-Fi\?/);
  assert.match(description, /Yes, it supports both 2\.4 GHz and 5 GHz networks\./);
  assert.equal(productImageIndex >= 0 && productImageIndex < faqIndex, true);
  assert.doesNotMatch(description, /window\.initAmazonFaq|data-faq-question|aria-expanded/);
});

test("scrapeAmazonProductDirect creates no draft data when both requested description sections are missing", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();

  installFetchMock(t, [
    {
      body: amazonProductHtml({
        buyboxPrice: "$129.99",
        descriptionHtml: "",
      }),
    },
    { body: '{"isValidAddress":1}' },
    {
      body: amazonProductHtml({
        buyboxPrice: "$129.99",
        postcode: "2217",
        descriptionHtml: "",
      }),
    },
  ]);

  await assert.rejects(
    scrapeAmazonProductDirect("https://www.amazon.com.au/dp/B0TEST1234", {
      postcode: "2217",
    }),
    (error) => {
      assert.equal(
        (error as { code?: string }).code,
        "AMAZON_DESCRIPTION_MISSING",
      );
      return true;
    },
  );
});

test("scrapeAmazonProductDirect reads original Amazon color images and skips video thumbnails", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();
  const imageScript = `
    <script>
      window.ImageBlockATF = {
        "colorImages": {
          "initial": [
            {
              "hiRes": "https://m.media-amazon.com/images/I/main-original._AC_SL1500_.jpg",
              "large": "https://m.media-amazon.com/images/I/main-preview._AC_SY450_.jpg"
            },
            {
              "hiRes": "https://m.media-amazon.com/images/I/second-original._AC_SL1500_.jpg",
              "large": "https://m.media-amazon.com/images/I/second-preview._AC_SY450_.jpg"
            },
            {
              "large": "https://m.media-amazon.com/images/I/product-video-preview._AC_SL1500_.jpg"
            },
            {
              "main": {
                "https://m.media-amazon.com/images/I/third-small._AC_SX300_.jpg": [300, 300],
                "https://m.media-amazon.com/images/I/third-large._AC_SX679_.jpg": [679, 679]
              }
            }
          ]
        }
      };
    </script>
  `;

  installFetchMock(t, [
    {
      body: amazonProductHtml({
        buyboxPrice: "$166.24",
        imageScript,
      }),
    },
    { body: '{"isValidAddress":1}' },
    {
      body: amazonProductHtml({
        buyboxPrice: "$166.24",
        imageScript,
        postcode: "2217",
      }),
    },
  ]);

  const product = await scrapeAmazonProductDirect(
    "https://www.amazon.com.au/dp/B0TEST1234",
    { postcode: "2217" }
  );

  assert.deepEqual(product.images, [
    "https://m.media-amazon.com/images/I/main-original.jpg",
    "https://m.media-amazon.com/images/I/second-original.jpg",
    "https://m.media-amazon.com/images/I/third-large.jpg",
  ]);
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

test("scrapeAmazonProductDirect retries the localized selected-variant buybox", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();
  const calls = installFetchMock(t, [
    { body: amazonProductHtml({ buyboxPrice: "$79.99" }) },
    { body: '{"isValidAddress":1}' },
    {
      body: amazonProductHtml({
        postcode: "2217",
      }),
    },
    {
      body: amazonProductHtml({
        buyboxPrice: "$79.99",
        postcode: "2217",
      }),
    },
  ]);

  const product = await scrapeAmazonProductDirect(
    "https://www.amazon.com.au/dp/B0GWM5MWXX",
    {
      postcode: "2217",
      priceTrackingMode: "REGULAR",
    }
  );

  assert.equal(product.price, 79.99);
  assert.equal(calls.length, 4);
  assert.match(String(calls[3]?.input), /\?th=1&psc=1$/);
});

test("scrapeAmazonProductDirect uses a rendered selected-variant price fallback", async (t) => {
  const { scrapeAmazonProductDirect } = await loadAmazonDirectScraper();
  const fallbackRequests: Array<{
    asin: string;
    postcode: string;
    priceTrackingMode: string;
  }> = [];

  installFetchMock(t, [
    { body: amazonProductHtml({ pageWidePrice: "$79.99" }) },
    { body: '{"isValidAddress":1}' },
    {
      body: amazonProductHtml({
        pageWidePrice: "$79.99",
        postcode: "2217",
      }),
    },
    {
      body: amazonProductHtml({
        pageWidePrice: "$79.99",
        postcode: "2217",
      }),
    },
  ]);

  const product = await scrapeAmazonProductDirect(
    "https://www.amazon.com.au/dp/B0GWM5MWXX",
    {
      postcode: "2217",
      priceTrackingMode: "REGULAR",
      resolveMissingPrice: async (request) => {
        fallbackRequests.push(request);
        return 119.99;
      },
    },
  );

  assert.equal(product.price, 119.99);
  assert.equal(product.amazonPriceTrackingMode, "REGULAR");
  assert.deepEqual(product.priceChoices?.regular, {
    price: 119.99,
    label: "Regular price",
  });
  assert.deepEqual(fallbackRequests, [
    {
      asin: "B0TEST1234",
      postcode: "2217",
      priceTrackingMode: "REGULAR",
    },
  ]);
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
        (error as { code: string }).code,
        "AMAZON_BUYBOX_PRICE_MISSING"
      );
      return true;
    }
  );
});

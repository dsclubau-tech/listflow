import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { chromium, type Browser } from "playwright-core";
import { scrapeAmazonPrice } from "./amazon-scraper";
import { PriceCheckFailure } from "./price-check-failures";
import { AmazonDeliveryFailure } from "./amazon-delivery-recovery";
let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
const asin = "B0TEST1234";
function fixture(extra: string) {
    return `<html><head><title>Fixture product</title></head><body>
    <input id="ASIN" value="${asin}"><h1 id="productTitle">Fixture product</h1>
    <div id="glow-ingress-line2">Kogarah 2217</div><div id="availability">Only 10 left in stock.</div>
    <div id="buybox"><div id="corePrice_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">$100.00</span></span></div><button id="add-to-cart-button">Add to cart</button></div>
    <div id="deliveryBlockMessage">FREE delivery tomorrow</div>${extra}</body></html>`;
}
function offlineBrowser(body: string): Browser {
    return {
        newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
            const context = await browser.newContext(options);
            await context.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body }));
            return {
                newPage: async () => {
                    const page = await context.newPage();
                    page.route = async () => { };
                    page.setDefaultTimeout(1500);
                    return page;
                },
                close: () => context.close(), storageState: () => context.storageState(),
            };
        },
    } as unknown as Browser;
}
const unmatched = '<div id="variation_color_name"><span class="selection">Blue</span><button title="Blue">Blue</button></div>';
function selectedWithoutPrice(change = "") {
    return `<div id="variation_color_name"><span class="selection">Blue</span><button onclick="document.querySelector('#variation_color_name .selection').textContent='Black';document.getElementById('corePrice_feature_div').innerHTML='';${change}">Black</button></div>`;
}
for (const sharedSnapshot of [false, true]) {
    for (const scenario of ["unmatched", "selected-without-price"] as const) {
        test(`${scenario} retains final verification with shared snapshot ${sharedSnapshot}`, async () => {
            const started = Date.now();
            const result = await scrapeAmazonPrice(asin, offlineBrowser(fixture(scenario === "unmatched" ? unmatched : selectedWithoutPrice())), "2217", "DEAL", { colour: "Black" }, { allowDealPriceFallback: true, sharedSnapshot });
            assert.equal(result.variantSelectionFailed, true);
            assert.match(result.variantSelectionReason ?? "", scenario === "unmatched" ? /could not select saved colour "Black"/ : /Selected variation.*no buybox price/);
            assert.equal(result.postcodeVerified, true);
            assert.equal(result.detectedAsin, asin);
            assert.equal(result.identityOutcome, "MATCH");
            assert.ok(result.observedAt && result.observedAt.getTime() >= started);
            assert.equal(result.priceMode, "DEAL");
            assert.equal(result.selectedPriceMode, null);
            assert.equal(result.price, null);
            assert.equal(result.stockLeft, null);
            assert.deepEqual(result.priceChoices, { regular: null, deal: null });
            assert.equal(result.buyBoxOutcome, "UNKNOWN");
            assert.equal(result.acceptedPriceSource ?? null, null);
            assert.equal(result.shippingEvidence, undefined);
        });
    }
    for (const [scenario, change, code] of [
        ["wrong-postcode", "document.getElementById('glow-ingress-line2').textContent='Sydney 2000';", "TECHNICAL_ERROR"],
        ["wrong-ASIN", "document.getElementById('ASIN').value='B0OTHER123';", "AMAZON_ASIN_REDIRECT"],
        ["missing-ASIN", "document.getElementById('ASIN').remove();", "TECHNICAL_ERROR"],
        ["challenge", "document.title='Robot Check';", "TECHNICAL_ERROR"],
    ] as const) {
        test(`variation failure cannot bypass ${scenario} with shared snapshot ${sharedSnapshot}`, async () => {
            await assert.rejects(scrapeAmazonPrice(asin, offlineBrowser(fixture(selectedWithoutPrice(change))), "2217", "REGULAR", { colour: "Black" }, { sharedSnapshot }), error => error instanceof PriceCheckFailure && error.code === code &&
                (scenario !== "wrong-postcode" || error instanceof AmazonDeliveryFailure));
        });
    }
}

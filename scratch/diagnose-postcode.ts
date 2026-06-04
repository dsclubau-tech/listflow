/**
 * Diagnostic script: test Amazon postcode setter on multiple ASINs
 * to see exactly what happens and where it breaks.
 */
import { chromium } from "playwright";

const TEST_ASINS = [
  "B09FL5CVK4", // W-KING speaker (fails)
  "B0DBKT8NCH", // STARWORK mechanic (fails)  
  "B07ZRNJ4DX", // iClever keyboard (fails)
];

const POSTCODE = "2217";

async function testPostcode(asin: string, index: number) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Hide webdriver
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  console.log(`\n=== ASIN ${index + 1}: ${asin} ===`);

  try {
    console.log("  Navigating...");
    await page.goto(`https://www.amazon.com.au/dp/${asin}`, {
      waitUntil: "load",
      timeout: 30000,
    });

    // Check delivery location BEFORE setting postcode
    const locationBefore = await page
      .evaluate(() => {
        const el = document.querySelector("#glow-ingress-line2");
        return el?.textContent?.trim() ?? "(not found)";
      })
      .catch(() => "(error)");
    console.log("  Location BEFORE:", locationBefore);

    // Try AJAX postcode
    console.log("  Calling AJAX postcode setter...");
    const ajaxResult = await page.evaluate(async (pc: string) => {
      const formData = new URLSearchParams({
        locationType: "LOCATION_INPUT",
        zipCode: pc,
        storeContext: "pc",
        deviceType: "web",
        pageType: "Detail",
        actionSource: "glow",
      });

      const response = await fetch("/gp/delivery/ajax/address-change.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const status = response.status;
      const text = await response.text();
      const isValid =
        text.includes('"isValidAddress":1') ||
        text.includes('"isValidAddress": 1');

      return {
        status,
        isValid,
        bodySnippet: text.slice(0, 300),
        bodyLength: text.length,
      };
    }, POSTCODE);

    console.log("  AJAX response status:", ajaxResult.status);
    console.log("  AJAX isValid:", ajaxResult.isValid);
    console.log("  AJAX body length:", ajaxResult.bodyLength);
    console.log("  AJAX body snippet:", ajaxResult.bodySnippet.slice(0, 200));

    if (ajaxResult.isValid) {
      // Reload page to see updated location
      await page.goto(`https://www.amazon.com.au/dp/${asin}`, {
        waitUntil: "load",
        timeout: 30000,
      });

      const locationAfter = await page
        .evaluate(() => {
          const el = document.querySelector("#glow-ingress-line2");
          return el?.textContent?.trim() ?? "(not found)";
        })
        .catch(() => "(error)");
      console.log("  Location AFTER:", locationAfter);

      // Check stock status
      const stockStatus = await page.evaluate(() => {
        const buybox = document.querySelector("#buybox, #availability");
        return buybox?.textContent?.trim().slice(0, 100) ?? "(no buybox)";
      });
      console.log("  Stock status:", stockStatus);

      // Try to get price
      const price = await page
        .locator(".a-price .a-offscreen")
        .first()
        .textContent({ timeout: 5000 })
        .catch(() => null);
      console.log("  Price found:", price ?? "(none)");
    }
  } catch (err) {
    console.log("  ERROR:", err instanceof Error ? err.message : String(err));
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  console.log("=== Amazon Postcode Diagnostic ===");
  console.log("Testing", TEST_ASINS.length, "ASINs with postcode", POSTCODE);
  console.log("Each gets its own fresh browser instance.\n");

  for (let i = 0; i < TEST_ASINS.length; i++) {
    await testPostcode(TEST_ASINS[i], i);
    // Wait between tests
    if (i < TEST_ASINS.length - 1) {
      const delay = 3000 + Math.random() * 4000;
      console.log(`  Waiting ${Math.round(delay / 1000)}s before next...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  console.log("\n=== Done ===");
}

main();

import { chromium } from "playwright";

async function diagnose() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  console.log("Navigating to Amazon...");
  await page.goto("https://www.amazon.com.au/dp/B0D36TKRB1", {
    waitUntil: "load",
    timeout: 30000,
  });

  // Wait extra time for JS rendering
  await page.waitForTimeout(5000);

  console.log("\n=== PAGE TITLE ===");
  console.log(await page.title());

  console.log("\n=== PAGE URL ===");
  console.log(page.url());

  // Check which price selectors exist
  const selectors = [
    "#priceblock_ourprice",
    ".a-price .a-offscreen",
    "#price_inside_buybox",
    'span.a-price[data-a-color="price"] .a-offscreen',
    "#corePrice_feature_div",
    "#apex_desktop",
    "#buybox",
    ".a-price",
    "#productTitle",
  ];

  console.log("\n=== SELECTOR CHECK ===");
  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    const text = count > 0
      ? await page.locator(sel).first().textContent({ timeout: 2000 }).catch(() => "(no text)")
      : null;
    console.log(`  ${sel}: ${count} found${text ? ` → "${text.trim().slice(0, 80)}"` : ""}`);
  }

  // Dump first 1000 chars of body
  console.log("\n=== BODY TEXT (first 1000 chars) ===");
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1000) ?? "(empty)");
  console.log(bodyText);

  // Check for bot detection
  console.log("\n=== BOT DETECTION CHECK ===");
  const hasRobotCheck = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    return {
      robotCheck: html.includes("Robot Check") || html.includes("robot") || html.includes("captcha"),
      sorry: html.includes("Sorry") && html.includes("robot"),
      webdriver: navigator.webdriver,
    };
  });
  console.log(JSON.stringify(hasRobotCheck, null, 2));

  await page.screenshot({ path: "d:/listflow/scratch/amazon-page.png", fullPage: false });
  console.log("\nScreenshot saved to d:/listflow/scratch/amazon-page.png");

  await browser.close();
}

diagnose().catch(console.error);

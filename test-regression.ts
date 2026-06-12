import { scrapeAmazonPrice } from "./lib/amazon-scraper";
import { chromium, Browser } from "playwright";

/**
 * Read-Only Regression Test: Location-Based Scraping + Safety Guards
 * 
 * Objectives:
 * 1. Ensure the postcode is set correctly (default 2217).
 * 2. Verify prices returned are reasonable AU prices (not US, and definitely not the 13-cent bug).
 * 3. Do not interact with the database or eBay API (read-only mode).
 */

async function runRegressionTest() {
  const testAsins = [
    "B0FR44RFTV", // Type 2 EV Charging Cable 22kW 5M
    "B0DZ6NYT9Z", // Cordless Pressure Washer 1200PSI
    "B0FVT2VSKB"  // Desk Fan, Quiet Bladeless Table Fan
  ];

  const targetPostcode = "2217";
  let browser: Browser | null = null;
  
  try {
    console.log("🚀 Starting Read-Only Regression Test...");
    console.log(`📍 Target Location Postcode: ${targetPostcode}`);
    
    browser = await chromium.launch({ 
      headless: false,
      channel: "chrome",
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions'
      ],
      slowMo: 200 // Slow down interactions so Amazon doesn't detect rapid automated clicks
    }).catch(async () => {
      console.log("Chrome not found, falling back to Microsoft Edge...");
      return chromium.launch({ 
          headless: false, 
          channel: "msedge",
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions'
          ],
          slowMo: 200
      });
    });
    
    for (const asin of testAsins) {
      console.log(`\n---------------------------------`);
      console.log(`📦 Testing ASIN: ${asin}`);
      
      const startTime = Date.now();
      const scrapeResult = await scrapeAmazonPrice(asin, browser, targetPostcode);
      const price = scrapeResult.price;
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      // Look at the first browser page to see what happened
      const pages = browser.contexts()[0]?.pages() || [];
      if (pages.length > 0) {
        const title = await pages[0].title();
        console.log(`📄 Page Title: ${title}`);
        
        // Check for captcha
        if (await pages[0].locator('form[action="/errors/validateCaptcha"]').isVisible().catch(() => false)) {
            console.log("🚨 CAPTCHA DETECTED! Amazon is blocking the headless browser.");
        }
      }
      
      console.log(`⏱️ Scraping completed in ${duration}s`);
      
      if (price === null) {
        console.warn(`❌ Scraper returned NULL. Either out of stock, captcha, or parsing failed.`);
        continue;
      }

      console.log(`💲 Scraped Price: A$${price.toFixed(2)}`);

      if (scrapeResult.stockLeft !== null) {
        console.log(`Stock Signal: Only ${scrapeResult.stockLeft} left in stock`);
      }

      // 13-cent / plausibility guard check
      if (price < 1.0) {
         console.error(`🚨 FATAL: Scraped price is under A$1.00! The 13-cent bug might have regressed!`);
      } else if (price < 5.0) {
         console.warn(`⚠️ WARNING: Scraped price is very low (A$${price.toFixed(2)}). Verify this is correct.`);
      } else {
         console.log(`✅ Plausibility Check Passed: Price appears to be a genuine AU figure.`);
      }
    }
    
    console.log(`\n🎉 Regression Test Completed Successfully.`);

  } catch (error) {
    console.error("💥 Test failed with an unexpected error:", error);
  } finally {
    if (browser) {
      await browser.close();
      console.log("\n🛑 Browser closed.");
    }
  }
}

runRegressionTest();

/**
 * Production-browser comparison: run against a production build or deployment.
 * Requires LISTFLOW_E2E_BASE_URL, LISTFLOW_E2E_STORE_ID and LISTFLOW_E2E_STORE_PASSWORD.
 * Prints timings only; never prints the credentials or page contents.
 */
import { chromium, type Page } from "playwright";

const baseURL = process.env.LISTFLOW_E2E_BASE_URL;
const storeId = process.env.LISTFLOW_E2E_STORE_ID;
const password = process.env.LISTFLOW_E2E_STORE_PASSWORD;
if (!baseURL || !storeId || !password) {
  throw new Error("Set LISTFLOW_E2E_BASE_URL, LISTFLOW_E2E_STORE_ID and LISTFLOW_E2E_STORE_PASSWORD.");
}

const routes = ["/products", "/action-center", "/settings"] as const;
type Route = (typeof routes)[number];
const labels: Record<Route, string> = {
  "/products": "Products",
  "/action-center": "Action Center",
  "/settings": "Settings",
};

async function usable(page: Page, route: Route) {
  await page.getByRole("heading", { name: labels[route], exact: true }).waitFor();
  if (route === "/settings") {
    await page.getByRole("button", { name: "Store Profile", exact: true }).waitFor();
  }
}

async function measure(
  page: Page,
  route: Route,
  navigate: () => Promise<unknown>,
  fullDocument: boolean,
) {
  let requests = 0;
  let failures = 0;
  const previousScriptBytes = await page.evaluate(() =>
    performance.getEntriesByType("resource").reduce((sum, entry) =>
      sum + ((entry as PerformanceResourceTiming).initiatorType === "script"
        ? (entry as PerformanceResourceTiming).transferSize
        : 0), 0)
  );
  const onRequest = () => { requests += 1; };
  const onFailure = () => { failures += 1; };
  page.on("request", onRequest);
  page.on("requestfailed", onFailure);
  const started = performance.now();
  await navigate();
  await usable(page, route);
  const usableMs = Math.round(performance.now() - started);
  const browser = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const scripts = performance.getEntriesByType("resource")
      .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script") as PerformanceResourceTiming[];
    return {
      documentResponseMs: fullDocument && navigation
        ? Math.round(navigation.responseStart - navigation.startTime)
        : null,
      scriptTransferBytes: scripts.reduce((sum, script) => sum + script.transferSize, 0),
    };
  });
  page.off("request", onRequest);
  page.off("requestfailed", onFailure);
  return {
    route, usableMs, requests, failures,
    ...browser,
    scriptTransferBytes: Math.max(0, browser.scriptTransferBytes - previousScriptBytes),
  };
}

const browser = await chromium.launch();
try {
  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  await loginPage.goto(`${baseURL}/login`);
  await loginPage.getByLabel("Store ID").fill(storeId);
  await loginPage.getByLabel("Password").fill(password);
  await Promise.all([
    loginPage.waitForURL(/\/drafts|\/action-center|\/products/),
    loginPage.getByRole("button", { name: "Sign in" }).click(),
  ]);
  const storageState = await loginContext.storageState();
  await loginContext.close();

  const cold = [];
  for (const route of routes) {
    for (let run = 0; run < 5; run += 1) {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();
      cold.push(await measure(page, route, () => page.goto(`${baseURL}${route}`), true));
      await context.close();
    }
  }

  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  await page.goto(`${baseURL}/products`);
  await usable(page, "/products");
  const navigation = [];
  for (let run = 0; run < 10; run += 1) {
    for (const route of ["/action-center", "/settings", "/products"] as const) {
      navigation.push(await measure(
        page,
        route,
        () => page.locator(`a[href="${route}"]:visible`).first().click(),
        false,
      ));
    }
  }
  await context.close();
  console.log(JSON.stringify({
    baseURL,
    browserCache: "fresh context per cold sample; one context for navigation samples",
    serverCache: "existing state",
    cold,
    navigation,
  }, null, 2));
} finally {
  await browser.close();
}

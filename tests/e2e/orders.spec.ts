import { expect, test, type Page } from "playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import path from "node:path";
import type { OrdersPageData } from "../../types/order";

let server: Server;
let origin: string;
let script = "", css = "";
const fixture: OrdersPageData = {
  storeId: "store", totalCount: 2, page: 1, pageSize: 50,
  sync: { activatedAt: "2026-10-08T00:00:00Z", lastSuccessAt: "2026-10-08T00:05:00Z", error: null },
  rows: [
    { id: "matched", title: "Dreamegg Sunrise Sound Machine", quantity: 2, image: null, buyTotal: 20, buyCurrency: "AUD", sellTotal: 50,
      currency: "AUD", profit: 24.4, buyItemId: "B012345678", ebayItemId: "376869964684", status: "PENDING", estimatedArrival: null, matched: true },
    { id: "unmatched", title: "Unmatched eBay item", quantity: 1, image: null, buyTotal: null, buyCurrency: "AUD", sellTotal: 79.8,
      currency: "AUD", profit: null, buyItemId: null, ebayItemId: "377520164115", status: "PENDING", estimatedArrival: null, matched: false },
  ],
};

test.beforeAll(async () => {
  const bundled = await build({
    stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import Orders from "./components/OrdersPageClient"; createRoot(document.getElementById("root")).render(React.createElement(Orders, { initialData: window.__ORDERS__ }));',
      resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  script = bundled.outputFiles[0].text;
  const cssPath = path.join(process.cwd(), "app/globals.css");
  css = (await postcss([tailwindcss()]).process(await readFile(cssPath, "utf8"), { from: cssPath })).css;
  server = createServer((request, response) => {
    if (request.url === "/orders.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); }
    else if (request.url === "/orders.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
    else { response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/orders.css"></head><body style="background:#eaf3fb;font-family:Arial,sans-serif"><main style="padding:24px;max-width:1600px;margin:auto"><div id="root"></div></main><script src="/orders.js"></script></body></html>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

async function open(page: Page, initial = fixture) {
  const state: OrdersPageData = structuredClone(initial);
  const writes: unknown[] = [];
  let fail = false;
  await page.addInitScript(data => { (window as unknown as { __ORDERS__: OrdersPageData }).__ORDERS__ = data; }, initial);
  await page.route("**/api/orders**", async route => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const edit = request.postDataJSON();
      writes.push(edit);
      if (fail) { await route.fulfill({ status: 503, json: { error: "Could not save the order. Please try again." } }); return; }
      const id = new URL(request.url()).pathname.split("/").pop();
      Object.assign(state.rows.find(row => row.id === id)!, edit);
      await route.fulfill({ json: { id, ...edit } });
    } else await route.fulfill({ json: state });
  });
  await page.goto(origin + "/orders");
  await expect(page.getByRole("heading", { name: /Orders/ })).toBeVisible();
  return { state, writes, failEdits: () => { fail = true; } };
}

test("shows seven columns, line totals, links, exact statuses, and unmatched costs", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("columnheader")).toHaveText(["Image", "Title", "Price", "Profit", "Item ID and link", "Order status", "Estimated arrival"]);
  const matched = page.getByRole("row").filter({ hasText: "Dreamegg" });
  for (const value of ["Quantity: 2", "$20.00", "$50.00", "$24.40"]) await expect(matched).toContainText(value);
  await expect(matched.getByRole("link", { name: "B012345678" })).toHaveAttribute("href", "https://www.amazon.com.au/dp/B012345678");
  await expect(matched.getByRole("link", { name: "376869964684" })).toHaveAttribute("href", "https://www.ebay.com.au/itm/376869964684");
  await expect(matched.locator("option")).toHaveText(["Pending", "Ordered", "Shipped", "Delivered", "Canceled"]);
  const unmatched = page.getByRole("row").filter({ hasText: "Unmatched eBay item" });
  await expect(unmatched).toContainText("No matching Listflow product");
  await expect(unmatched).toContainText("N/A");
  await expect(page.getByRole("button", { name: /sync/i })).toHaveCount(0);
  await page.screenshot({ path: "test-results/orders-desktop.png", fullPage: true });
});

test("saves manual status and date, persists after reload, and clears date", async ({ page }) => {
  const f = await open(page);
  const status = page.getByLabel("Order status for Dreamegg Sunrise Sound Machine");
  const date = page.getByLabel("Estimated arrival for Dreamegg Sunrise Sound Machine");
  for (const value of ["ORDERED", "SHIPPED", "DELIVERED", "CANCELED", "PENDING"]) {
    await status.selectOption(value);
    await expect(status).toHaveValue(value);
  }
  await date.fill("2026-10-12"); await expect(date).toHaveValue("2026-10-12");
  await expect.poll(() => f.state.rows[0].estimatedArrival).toBe("2026-10-12");
  await page.reload();
  // addInitScript represents initial SSR data; automatic refresh restores persisted edits.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(date).toHaveValue("2026-10-12");
  await date.fill(""); await expect(date).toHaveValue("");
  await expect.poll(() => f.state.rows[0].estimatedArrival).toBeNull();
});

test("failed edits keep the saved value and show an actionable error", async ({ page }) => {
  const f = await open(page); f.failEdits();
  const status = page.getByLabel("Order status for Dreamegg Sunrise Sound Machine");
  await status.selectOption("ORDERED");
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(status).toHaveValue("PENDING");
});

test("background page refresh cannot overwrite a completed manual edit with stale data", async ({ page }) => {
  const f = await open(page);
  let release!: () => void, began!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  let first = true;
  await page.route("**/api/orders?**", async route => {
    if (first) { first = false; began(); await waiting; await route.fulfill({ json: fixture }); }
    else await route.fulfill({ json: f.state });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await started;
  const status = page.getByLabel("Order status for Dreamegg Sunrise Sound Machine");
  await status.selectOption("ORDERED"); await expect(status).toHaveValue("ORDERED");
  release(); await expect(status).toHaveValue("ORDERED");
});

test("empty state and mobile layout remain usable without page-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { ...fixture, totalCount: 0, rows: [] });
  const emptyMessage = page.getByText("No orders yet", { exact: true });
  await expect(emptyMessage).toBeVisible();
  const box = await emptyMessage.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/orders-mobile-empty.png", fullPage: true });
});

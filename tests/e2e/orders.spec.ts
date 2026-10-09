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
      currency: "AUD", profit: 24.4, buyItemId: "B012345678", ebayItemId: "376869964684", status: "PENDING", estimatedArrival: null, matched: true, matchedProductId: "product-1", ebayOrderId: "13-15259-24206", orderGroupKey: "order-one", internalNote: null },
    { id: "unmatched", title: "Unmatched eBay item", quantity: 1, image: null, buyTotal: null, buyCurrency: "AUD", sellTotal: 79.8,
      currency: "AUD", profit: null, buyItemId: null, ebayItemId: "377520164115", status: "PENDING", estimatedArrival: null, matched: false, matchedProductId: null, ebayOrderId: "23-15239-85394", orderGroupKey: "order-two", internalNote: null },
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
      const parts = new URL(request.url()).pathname.split("/");
      if (parts.at(-1) === "note") {
        const row = state.rows.find(row => row.id === parts.at(-2))!;
        const internalNote = typeof edit.internalNote === "string" ? edit.internalNote.trim() || null : null;
        for (const line of state.rows) if (line.orderGroupKey === row.orderGroupKey) line.internalNote = internalNote;
        await route.fulfill({ json: { orderGroupKey: row.orderGroupKey, internalNote } });
      } else {
        const id = parts.at(-1);
        Object.assign(state.rows.find(row => row.id === id)!, edit);
        await route.fulfill({ json: { id, ...edit } });
      }
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

test("shared order notes can be saved from either row, reloaded, edited, and cleared", async ({ page }) => {
  const shared = { ...fixture, rows: [fixture.rows[0], { ...fixture.rows[1], ebayOrderId: fixture.rows[0].ebayOrderId,
    orderGroupKey: fixture.rows[0].orderGroupKey }] };
  const f = await open(page, shared);
  const first = page.getByRole("button", { name: "Add order note for Dreamegg Sunrise Sound Machine", exact: true });
  await first.click();
  const dialog = page.getByRole("dialog", { name: "Order note" });
  await expect(dialog).toContainText("eBay order: 13-15259-24206");
  await expect(dialog).toContainText("every item in this eBay order");
  await page.getByLabel("Internal note", { exact: true }).fill("  Supplier bought\nTracking to follow  ");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => f.state.rows.map(row => row.internalNote)).toEqual(["Supplier bought\nTracking to follow", "Supplier bought\nTracking to follow"]);
  await expect(page.getByRole("button", { name: /^Edit order note for/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Edit order note for Dreamegg Sunrise Sound Machine", exact: true })).toBeFocused();
  await page.reload();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.getByRole("button", { name: "Edit order note for Unmatched eBay item", exact: true }).click();
  await expect(page.getByLabel("Internal note", { exact: true })).toHaveValue("Supplier bought\nTracking to follow");
  await page.getByLabel("Internal note", { exact: true }).fill("<b>Plain text</b>");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect.poll(() => f.state.rows[0].internalNote).toBe("<b>Plain text</b>");
  await page.getByRole("button", { name: "Edit order note for Dreamegg Sunrise Sound Machine", exact: true }).click();
  await expect(page.getByLabel("Internal note", { exact: true })).toHaveValue("<b>Plain text</b>");
  await page.getByLabel("Internal note", { exact: true }).fill(" \n ");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Add order note for/ })).toHaveCount(2);
  expect(f.state.rows.map(row => row.internalNote)).toEqual([null, null]);
});

test("failed note saves preserve draft and saved value; cancel and Escape restore focus", async ({ page }) => {
  const f = await open(page, { ...fixture, rows: [{ ...fixture.rows[0], internalNote: "Saved note" }, fixture.rows[1]] });
  f.failEdits();
  const icon = page.getByRole("button", { name: "Edit order note for Dreamegg Sunrise Sound Machine", exact: true });
  await icon.click();
  const draft = page.getByLabel("Internal note", { exact: true });
  await expect(draft).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(draft).toBeFocused();
  await draft.fill("Unsaved note");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(draft).toHaveValue("Unsaved note");
  expect(f.state.rows[0].internalNote).toBe("Saved note");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(icon).toBeFocused();
  await icon.click(); await expect(draft).toHaveValue("Saved note");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(icon).toBeFocused();
});

test("background refresh keeps the note draft and stale responses cannot replace a successful note save", async ({ page }) => {
  const f = await open(page);
  await page.getByRole("button", { name: "Add order note for Dreamegg Sunrise Sound Machine", exact: true }).click();
  const draft = page.getByLabel("Internal note", { exact: true });
  await draft.fill("My draft");
  f.state.rows[0].internalNote = "Saved elsewhere";
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("button", { name: "Edit order note for Dreamegg Sunrise Sound Machine", exact: true })).toHaveCount(1);
  await expect(draft).toHaveValue("My draft");
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
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  release();
  await expect(page.getByRole("button", { name: "Edit order note for Dreamegg Sunrise Sound Machine", exact: true })).toHaveAttribute("title", "Edit order note: My draft");
  expect(f.state.rows[1].internalNote).toBeNull();
});

test("product action opens its existing editor in a new tab and unmatched actions stay disabled", async ({ page }) => {
  const f = await open(page);
  const button = page.getByRole("button", { name: "More options for Dreamegg Sunrise Sound Machine", exact: true });
  await button.focus(); await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Order options for Dreamegg Sunrise Sound Machine" });
  const action = menu.getByRole("menuitem", { name: "Edit Product", exact: true });
  await expect(action).toBeFocused();
  await expect(action).toHaveAttribute("href", "/products?productId=product-1");
  await expect(action).toHaveAttribute("rel", "noopener noreferrer");
  const before = page.url();
  const popupEvent = page.waitForEvent("popup");
  await action.click(); const popup = await popupEvent;
  await popup.waitForLoadState(); expect(new URL(popup.url()).pathname).toBe("/products");
  expect(new URL(popup.url()).searchParams.get("productId")).toBe("product-1");
  expect(page.url()).toBe(before); expect(f.writes).toHaveLength(0);
  await popup.close();
  f.state.rows[0].buyTotal = 30; f.state.rows[0].profit = 14.4;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("row").filter({ hasText: "Dreamegg" })).toContainText("$30.00");
  await page.getByRole("button", { name: "More options for Unmatched eBay item", exact: true }).click();
  const unmatched = page.getByRole("menu", { name: "Order options for Unmatched eBay item" });
  await expect(unmatched.getByRole("menuitem", { name: "Edit Product" })).toHaveAttribute("aria-disabled", "true");
  await expect(unmatched).toContainText("No matching Listflow product.");
  await page.keyboard.press("Escape"); await expect(unmatched).not.toBeVisible();
  await expect(page.getByRole("button", { name: "More options for Unmatched eBay item", exact: true })).toBeFocused();
});

test("note dialog and menu remain within a small viewport and outside clicks dismiss the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await open(page);
  const trigger = page.getByRole("button", { name: "More options for Unmatched eBay item", exact: true });
  await trigger.scrollIntoViewIfNeeded(); await trigger.click();
  const menu = page.getByRole("menu", { name: "Order options for Unmatched eBay item" });
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(360);
  await page.screenshot({ path: "test-results/orders-note-menu-mobile.png", fullPage: true });
  await page.getByRole("heading", { name: /Orders/ }).click(); await expect(menu).not.toBeVisible();
  await page.getByRole("button", { name: "Add order note for Unmatched eBay item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Order note" });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);
  await page.screenshot({ path: "test-results/orders-note-dialog-mobile.png", fullPage: true });
});

test("a pending note save rejects duplicate submission and keeps the dialog open", async ({ page }) => {
  const f = await open(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route("**/api/orders/*/note", async route => {
    calls++; await waiting;
    f.state.rows[0].internalNote = "Pending note";
    await route.fulfill({ json: { orderGroupKey: "order-one", internalNote: "Pending note" } });
  });
  await page.getByRole("button", { name: "Add order note for Dreamegg Sunrise Sound Machine", exact: true }).click();
  await page.getByLabel("Internal note", { exact: true }).fill("Pending note");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeVisible();
  expect(calls).toBe(1); release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

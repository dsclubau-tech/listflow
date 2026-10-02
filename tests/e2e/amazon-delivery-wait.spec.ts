import { expect, test } from "playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
const styles = postcss([tailwindcss()]).process(fs.readFileSync("app/globals.css", "utf8"), {
  from: path.resolve("app/globals.css"),
}).then(result => result.css);
const bundle = build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import ProductsPageClient from "./components/ProductsPageClient";
  window.deliveryUi = { paths: [], refreshes: 0 };
  createRoot(document.getElementById("root")).render(<ProductsPageClient products={[]} totalCount={809} page={1} pageSize={50}
    sortBy="updatedAt" sortOrder="desc" importedFilter={null} productFilter="all" hasAdvancedFilters={false} supplierOptions={[]} />);
` }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
  plugins: [{ name: "app-shell", setup(builder) {
    builder.onResolve({ filter: /^(next\/(navigation|dynamic|image)|@\/components\/(DraftsTable|BulkEditModal|PromotedListingsModal))$/ }, args => ({ path: args.path, namespace: "shell" }));
    builder.onLoad({ filter: /.*/, namespace: "shell" }, args => ({ contents: args.path === "next/navigation" ? `
      const params = new URLSearchParams();
      const router = { refresh(){ window.deliveryUi.refreshes++; }, push(path){ window.deliveryUi.paths.push(path); }, replace(path){ window.deliveryUi.paths.push(path); }, prefetch(){} };
      export const useRouter = () => router; export const usePathname = () => "/products"; export const useSearchParams = () => params;
    ` : args.path === "next/dynamic" ? "export default () => () => null;" : "export default () => null;" }));
  } }],
}).then(result => result.outputFiles[0].text);

for (const [status, width] of [["QUEUED", 1280], ["RUNNING", 390]] as const) test(`${status} deferred checks at ${width}px preserve readable waiting text and usable controls`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const css = await styles;
  const now = new Date().toISOString();
  let job = { id: "postcode-job", status: status as string, scope: "ALL", total: 809, checked: 2, changed: 0, pendingReview: 0,
    failed: 0, skipped: 2, remaining: 807, canResume: false, reason: "Amazon delivery setup unavailable.", errorMessage: null,
    createdAt: now, updatedAt: now, startedAt: now, completedAt: null, dismissedAt: null,
    waitReason: "Amazon delivery setup unavailable. Remaining products preserved.", retryAt: new Date(Date.now() + 60000).toISOString(),
    technicalFailureCode: "AMAZON_DELIVERY_HTTP_ERROR" };
  let cancellations = 0;
  await page.route("http://listflow.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/products") { await route.fulfill({ contentType: "text/html", body: `<html><head><style>${css}</style></head><body><div id="root"></div></body></html>` }); return; }
    if (url.pathname.endsWith("/cancel")) {
      cancellations++; job = { ...job, status: "CANCELLED", canResume: true, retryAt: "" };
      await route.fulfill({ json: { job } }); return;
    }
    if (url.pathname.startsWith("/api/price-check/jobs/")) { await route.fulfill({ json: { job } }); return; }
    await route.fulfill({ json: { job: null, suggestions: [], products: [], stores: [], workers: [], storeId: "store-a" } });
  });
  await page.goto("http://listflow.test/products"); await page.addScriptTag({ content: await bundle });
  await expect(page.getByText(/Amazon delivery setup unavailable\. Retrying at/)).toBeVisible();
  await expect(page.getByText(/Completed 2 of 809; remaining products preserved/)).toBeVisible();
  await expect(page.getByText(/Completed 2 of 809; remaining products preserved/)).toHaveCSS("white-space", "normal");
  await expect(page.getByText(/Checked 809 products/)).toHaveCount(0);
  await page.getByLabel("Search products", { exact: true }).fill("kettle");
  await page.getByLabel("Search products", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => cancellations).toBe(1);
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(page.getByText(/Retrying at/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { deliveryUi: { paths: string[] } }).deliveryUi.paths.length)).toBeGreaterThanOrEqual(2);
  await page.getByLabel("Search products", { exact: true }).fill("another product");
});

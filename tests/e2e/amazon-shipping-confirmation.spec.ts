import { expect, test as base } from "playwright/test";
import { build } from "esbuild";

const origin = "http://listflow.test";
const confirmation = { sourceJobId: "source", productId: "draft", nonce: "challenge", message: "Unverified" };
const bundle = build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import ShippingUploadPrompt from "./components/ShippingUploadPrompt";
    function Harness() {
      const [visible, setVisible] = useState(true);
      return visible ? <ShippingUploadPrompt title="Synthetic draft" confirmation={${JSON.stringify(confirmation)}}
        onComplete={() => setVisible(false)} /> : <p>Decision saved</p>;
    }
    createRoot(document.getElementById("root")).render(<React.StrictMode><Harness /></React.StrictMode>);
  ` }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
}).then(result => result.outputFiles[0].text);

type Fixture = { requests: Array<{ method: string; path: string; body: unknown }>; fail: boolean; wait: Promise<void> | null };
const test = base.extend<{ shipping: Fixture }>({
  shipping: async ({ page }, provide) => {
    const state: Fixture = { requests: [], fail: false, wait: null };
    const errors: string[] = [], unexpected: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && url.pathname === "/shipping" && request.isNavigationRequest()) {
        await route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${await bundle}</script></body></html>` });
      } else if (url.origin === origin && ["/api/upload", "/api/upload/shipping-confirmation"].includes(url.pathname)) {
        state.requests.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
        await state.wait;
        await route.fulfill({ status: state.fail ? 409 : 200, json: state.fail ? { error: "Context changed. Retry the check." } : { success: true } });
      } else { unexpected.push(request.url()); await route.abort(); }
    });
    await page.goto(`${origin}/shipping`);
    await provide(state);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  },
});

test("retry checks this item without approving unknown delivery", async ({ page, shipping }) => {
  await page.getByRole("button", { name: "Retry check", exact: true }).click();
  await expect(page.getByText("Decision saved")).toBeVisible();
  expect(shipping.requests).toEqual([{ method: "POST", path: "/api/upload", body: { productId: "draft", background: true } }]);
});
test("upload anyway sends the server challenge for this attempt", async ({ page, shipping }) => {
  await page.getByRole("button", { name: "Upload anyway", exact: true }).click();
  await expect(page.getByText("Decision saved")).toBeVisible();
  expect(shipping.requests).toEqual([{ method: "POST", path: "/api/upload", body: { productId: "draft", background: true, shippingConfirmation: confirmation } }]);
});
test("cancel removes confirmation without uploading", async ({ page, shipping }) => {
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Decision saved")).toBeVisible();
  expect(shipping.requests).toEqual([{ method: "DELETE", path: "/api/upload/shipping-confirmation", body: { shippingConfirmation: confirmation } }]);
});
test("failed decisions retain the draft prompt and allow retry", async ({ page, shipping }) => {
  shipping.fail = true;
  await page.getByRole("button", { name: "Upload anyway", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Context changed. Retry the check.");
  await expect(page.getByRole("region", { name: "Shipping confirmation" })).toBeVisible();
  shipping.fail = false;
  await page.getByRole("button", { name: "Retry check", exact: true }).click();
  await expect(page.getByText("Decision saved")).toBeVisible();
});
test("duplicate clicks and alternate decisions are disabled during a request", async ({ page, shipping }) => {
  let release = () => {};
  shipping.wait = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: "Upload anyway", exact: true }).click();
  await expect.poll(() => shipping.requests.length).toBe(1);
  for (const name of ["Retry check", "Upload anyway", "Cancel"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  release();
  await expect(page.getByText("Decision saved")).toBeVisible();
  expect(shipping.requests).toHaveLength(1);
});

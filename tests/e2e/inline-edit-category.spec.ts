import { expect, test as base, type Page } from "playwright/test";
import { build } from "esbuild";
import type { UploadShippingConfirmation } from "../../lib/amazon-upload-shipping-policy";
import type { RequiredItemSpecific } from "../../components/draft-upload-response";

const origin = "http://listflow.test";
const productId = "synthetic-category-product";
const initialProduct = {
  id: productId, title: "Creative craft guide", fullTitle: "Creative craft guide", description: "A useful craft guide.",
  category: "267", categoryName: "Books", status: "DRAFT", condition: "New", price: 20, quantity: 1,
  asin: null, ebayItemId: null, images: [], templateId: null, policyTemplateId: null,
  paymentPolicyId: "payment-test", shippingPolicyId: "shipping-test", returnPolicyId: "return-test",
  promotedAdPercent: 0, amazonPriceTrackingMode: "REGULAR", errorMessage: null,
  store: { id: "synthetic-store", name: "Test store" },
  itemSpecifics: { Brand: "Acme", Author: "Alex Example", ISBN: "9780140328721", Material: "Paper",
    _Country: "AU", _PostalCode: "3175", _Location: "Dandenong North, VIC" },
};
type FixtureProduct = Omit<typeof initialProduct, "itemSpecifics"> & { itemSpecifics: Record<string, string> };
type SavedPayload = { category: string; categoryName: string; itemSpecifics: Record<string, string> };
type UploadJob = { id: string; status: "QUEUED" | "RUNNING" | "COMPLETED"; productIds: string[]; total: number;
  processed: number; succeeded: number; failed: number; errors: Array<{productId: string; error: string; shippingConfirmation?: UploadShippingConfirmation}> };
const queuedJob = (): UploadJob => ({ id: "synthetic-upload", status: "QUEUED", productIds: [productId],
  total: 1, processed: 0, succeeded: 0, failed: 0, errors: [] });

const bundle = build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import InlineEditForm from "./components/InlineEditForm";
    function Harness() {
      const [product, setProduct] = useState(window.fixtureProduct);
      const [mount, setMount] = useState(0);
      const [revision, setRevision] = useState(0);
      return <>
        <button onClick={() => setRevision(value => value + 1)}>Rerender parent</button>
        <output data-testid="parent-revision">{revision}</output>
        <button onClick={() => {
          setProduct(window.fixtureSavedProduct); setMount(value => value + 1);
        }}>Reopen saved product</button>
        <button onClick={() => setProduct(current => ({ ...current, categoryName: "Kitchen" }))}>Refresh saved category only</button>
        <InlineEditForm key={mount} product={product} onCollapse={() => {}} />
      </>;
    }
    createRoot(document.getElementById("root")).render(<React.StrictMode><Harness /></React.StrictMode>);
  ` },
  bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
  plugins: [{ name: "unrelated-editor-integrations", setup(builder) {
    const replacements: Record<string, string> = {
      "next/navigation": `const router = { refresh() { window.fixtureRefreshes++; } }; export function useRouter() { return router; }`,
      "next/link": `import React from "react"; export default function Link({ children, ...props }) { return <a {...props}>{children}</a>; }`,
      "@/components/ProductVariantsPanel": `export default function ProductVariantsPanel() { return null; }`,
      "@/components/RichTextEditor": `import React from "react"; export default function RichTextEditor({ value, onChange }) { return <textarea aria-label="Mock description editor" value={value} onChange={event => onChange(event.target.value)} />; }`,
    };
    builder.onResolve({ filter: /^(next\/navigation|next\/link|@\/components\/(ProductVariantsPanel|RichTextEditor))$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: replacements[args.path], loader: "tsx", resolveDir: process.cwd() }));
  } }],
}).then(result => result.outputFiles[0].text);

function field(page: Page, label: string) {
  return page.locator("label").filter({ hasText: new RegExp(`^${label}$`) }).locator("..").locator("input, select").first();
}
function specific(page: Page, name: string) {
  return page.getByRole("button", { name: `Remove ${name}`, exact: true }).locator("..").locator('input[placeholder="Value"], select');
}
async function showSpecifics(page: Page) { await page.getByRole("tab", { name: "Item Specifications", exact: true }).click(); }
async function showProduct(page: Page) { await page.getByRole("tab", { name: "Product", exact: true }).click(); }
async function editCurrentFields(page: Page) {
  await showSpecifics(page);
  await specific(page, "Material").fill("Cotton");
  await showProduct(page);
  await field(page, "Brand").fill("Northstar Crafts");
  // Exercise the real country and postcode inputs, then choose a real AU suburb.
  await field(page, "Default Item Country").selectOption("United States");
  await field(page, "Default Zipcode").fill("90210");
  await field(page, "Default Item Country").selectOption("Australia");
  await field(page, "Default Zipcode").fill("3175");
  await page.locator("select").filter({ has: page.locator('option[value="Bangholme"]') }).selectOption("Bangholme");
}
async function expectCurrentFields(page: Page) {
  await showProduct(page);
  await expect(field(page, "Brand")).toHaveValue("Northstar Crafts");
  await expect(field(page, "Default Item Country")).toHaveValue("Australia");
  await expect(field(page, "Default Zipcode")).toHaveValue("3175");
  await expect(page.getByText("Bangholme, VIC", { exact: true })).toBeVisible();
  await showSpecifics(page);
  await expect(specific(page, "Material")).toHaveValue("Cotton");
}
async function chooseKitchen(page: Page) {
  await showProduct(page);
  await page.getByRole("button", { name: "Re-suggest", exact: true }).click();
  await page.getByRole("button", { name: "Kitchen (185512)", exact: true }).click();
  await expect(field(page, "Category Name")).toHaveValue("Kitchen");
  await expect(field(page, "eBay Category ID")).toHaveValue("185512");
}

interface EditorFixture {
  product: FixtureProduct;
  savedProduct: FixtureProduct;
  requests: { path: string; method: string; body: unknown }[];
  saves: SavedPayload[];
  requiredSpecifics: RequiredItemSpecific[];
  currentJobs: UploadJob[];
  uploadOutcome: "queued" | "missing-specifics";
  saveFails: boolean;
  suggestionReady: Promise<void> | null;
  requirementsReady: Promise<void> | null;
  open(overrides?: Partial<FixtureProduct>): Promise<void>;
  reopen(): Promise<void>;
}
const test = base.extend<{ editor: EditorFixture }>({
  editor: async ({ page }, provide) => {
    const pageErrors: string[] = [], unexpectedRequests: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const state: EditorFixture = {
      product: structuredClone(initialProduct), savedProduct: structuredClone(initialProduct), requests: [], saves: [],
      requiredSpecifics: [], currentJobs: [], uploadOutcome: "queued", saveFails: false,
      suggestionReady: null, requirementsReady: null,
      async open(overrides = {}) {
        state.product = { ...structuredClone(initialProduct), ...overrides };
        state.savedProduct = structuredClone(state.product);
        await page.goto(`${origin}/category-editor`);
        await expect(field(page, "Brand")).toHaveValue("Acme");
        await expect(page.getByRole("status", { name: "Loading payment policies" })).toHaveCount(0);
        await expect.poll(() => state.requests.some(request => request.path === "/api/upload/jobs/current")).toBe(true);
      },
      async reopen() {
        await page.evaluate(product => {
          Object.assign(window, { fixtureSavedProduct: product });
        }, state.savedProduct);
        await page.getByRole("button", { name: "Reopen saved product", exact: true }).click();
        await expect(field(page, "Category Name")).toHaveValue(state.savedProduct.categoryName);
      },
    };
    const compiled = await bundle;
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (url.origin === origin && url.pathname === "/category-editor" && request.isNavigationRequest()) {
        const html = `<html><body><div id="root"></div><script>window.fixtureProduct=${JSON.stringify(state.product)};window.fixtureSavedProduct=window.fixtureProduct;window.fixtureRefreshes=0;</script><script>${compiled}</script></body></html>`;
        await route.fulfill({ contentType: "text/html", body: html });
        return;
      }
      const body: unknown = request.postData() ? request.postDataJSON() : null;
      state.requests.push({ path: url.pathname, method, body });
      if (url.origin !== origin) {
        unexpectedRequests.push(request.url()); await route.abort("blockedbyclient"); return;
      }
      if (method === "GET" && ["/api/templates", "/api/policy-templates"].includes(url.pathname)) await route.fulfill({ json: [] });
      else if (method === "GET" && url.pathname === "/api/policies") await route.fulfill({ json: {
        payment: [{ profileId: "payment-test", profileName: "Payment" }],
        shipping: [{ profileId: "shipping-test", profileName: "Shipping" }],
        returns: [{ profileId: "return-test", profileName: "Returns" }],
      } });
      else if (method === "GET" && url.pathname === "/api/upload/jobs/current") await route.fulfill({ json: { jobs: state.currentJobs } });
      else if (method === "GET" && url.pathname === "/api/ebay/category-aspects") {
        const required = structuredClone(state.requiredSpecifics);
        await state.requirementsReady;
        await route.fulfill({ json: { requiredItemSpecifics: required } });
      } else if (method === "POST" && url.pathname === "/api/suggest-category") {
        await state.suggestionReady;
        await route.fulfill({ json: [{ categoryId: "185512", categoryName: "Kitchen" }] });
      } else if (method === "PATCH" && url.pathname === `/api/products/${productId}`) {
        const payload = request.postDataJSON() as SavedPayload;
        state.saves.push(payload);
        if (state.saveFails) await route.fulfill({ status: 500, json: { error: "Synthetic save failure" } });
        else {
          state.savedProduct = { ...state.savedProduct, ...payload };
          await route.fulfill({ json: { id: productId } });
        }
      } else if (method === "POST" && url.pathname === "/api/upload") {
        expect(body).toEqual({ productId, background: true });
        if (state.uploadOutcome === "missing-specifics") {
          await route.fulfill({ status: 400, json: { error: "Please supply required Finish", missingItemSpecifics: ["Finish"],
            requiredItemSpecifics: [{ name: "Finish", values: ["Matte", "Gloss"] }] } });
        } else {
          state.currentJobs = [queuedJob()];
          await route.fulfill({ json: { message: "Upload queued", job: state.currentJobs[0] } });
        }
      } else if (method === "POST" && url.pathname === "/api/client-logs") await route.fulfill({ json: { ok: true } });
      else { unexpectedRequests.push(`${method} ${request.url()}`); await route.abort("blockedbyclient"); }
    });
    await provide(state);
    expect(unexpectedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  },
});

test("opening a non-book product retains saved book fields and hides internal metadata", async ({ page, editor }) => {
  await editor.open({ category: "185512", categoryName: "Kitchen" });
  await showSpecifics(page);
  await expect(specific(page, "Author")).toHaveValue("Alex Example");
  await expect(specific(page, "ISBN")).toHaveValue("9780140328721");
  await expect(page.getByRole("button", { name: /^Remove _/ })).toHaveCount(0);
});

test("selecting Kitchen retains book fields and unsaved specifics, brand, and location", async ({ page, editor }) => {
  await editor.open();
  await editCurrentFields(page);
  await chooseKitchen(page);
  await expectCurrentFields(page);
  await expect(specific(page, "Author")).toHaveValue("Alex Example");
  await expect(specific(page, "ISBN")).toHaveValue("9780140328721");
});

test("partial, blank, and completed category names retain every existing field", async ({ page, editor }) => {
  await editor.open();
  await editCurrentFields(page);
  for (const value of ["B", "", "Kitchen"]) {
    await showProduct(page);
    await field(page, "Category Name").fill(value);
    await expectCurrentFields(page);
    await expect(specific(page, "Author")).toHaveValue("Alex Example");
    await expect(specific(page, "ISBN")).toHaveValue("9780140328721");
  }
});

test("automatic category selection preserves edits made while its response is pending", async ({ page, editor }) => {
  let release!: () => void;
  editor.suggestionReady = new Promise<void>(resolve => { release = resolve; });
  try {
    await editor.open({ category: "", categoryName: "" });
    await expect.poll(() => editor.requests.some(request => request.path === "/api/suggest-category")).toBe(true);
    await editCurrentFields(page);
    release();
    await showProduct(page);
    await expect(field(page, "Category Name")).toHaveValue("Kitchen");
    await expect(field(page, "eBay Category ID")).toHaveValue("185512");
    await expectCurrentFields(page);
    await expect(specific(page, "Author")).toHaveValue("Alex Example");
    await expect(specific(page, "ISBN")).toHaveValue("9780140328721");
  } finally { release(); }
});

test("category typing preserves an unsaved country and postcode change", async ({ page, editor }) => {
  await editor.open();
  await field(page, "Default Item Country").selectOption("United States");
  await field(page, "Default Zipcode").fill("90210");
  await field(page, "Category Name").fill("Kitchen");
  await expect(field(page, "Default Item Country")).toHaveValue("United States");
  await expect(field(page, "Default Zipcode")).toHaveValue("90210");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(editor.saves[0].itemSpecifics).toMatchObject({ _Country: "US", _PostalCode: "90210", _Location: "90210" });
});

test("parent rerenders and saved-category-only refreshes preserve unsaved fields", async ({ page, editor }) => {
  await editor.open();
  await editCurrentFields(page);
  await page.getByRole("button", { name: "Rerender parent", exact: true }).click();
  await expect(page.getByTestId("parent-revision")).toHaveText("1");
  await page.getByRole("button", { name: "Refresh saved category only", exact: true }).click();
  await expectCurrentFields(page);
  await expect(specific(page, "Author")).toHaveValue("Alex Example");
});

test("manual removal of an optional field persists through save and reopen", async ({ page, editor }) => {
  await editor.open();
  await showSpecifics(page);
  await page.getByRole("button", { name: "Remove Material", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(editor.saves[0].itemSpecifics.Material).toBeUndefined();
  await editor.reopen();
  await showSpecifics(page);
  await expect(page.getByRole("button", { name: "Remove Material", exact: true })).toHaveCount(0);
  await expect(specific(page, "Author")).toHaveValue("Alex Example");
});

for (const action of ["Save", "Save & Import"] as const) {
  test(`${action} sends retained book fields and current edits after category selection`, async ({ page, editor }) => {
    await editor.open();
    await editCurrentFields(page);
    await chooseKitchen(page);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(() => editor.saves.length).toBe(1);
    expect(editor.saves[0]).toMatchObject({ category: "185512", categoryName: "Kitchen", itemSpecifics: {
      Author: "Alex Example", ISBN: "9780140328721", Material: "Cotton", Brand: "Northstar Crafts",
      _Country: "AU", _PostalCode: "3175", _Location: "Bangholme, VIC",
    } });
    if (action === "Save & Import") {
      await expect.poll(() => editor.requests.filter(request => request.path === "/api/upload").length).toBe(1);
      const writes = editor.requests.filter(request => request.method === "PATCH" || request.path === "/api/upload");
      expect(writes.map(request => request.path)).toEqual([`/api/products/${productId}`, "/api/upload"]);
      await expect(page.getByRole("button", { name: "Save & Import", exact: true })).toBeDisabled();
    } else {
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await editor.reopen();
      await showSpecifics(page);
      await expect(specific(page, "Author")).toHaveValue("Alex Example");
      await expect(specific(page, "ISBN")).toHaveValue("9780140328721");
    }
  });
}

test("new category requirements add missing rows while retaining current values", async ({ page, editor }) => {
  await editor.open();
  await editCurrentFields(page);
  editor.requiredSpecifics = [{ name: "Finish", values: ["Matte", "Gloss"] }];
  await chooseKitchen(page);
  await showSpecifics(page);
  await expect(specific(page, "Finish")).toBeVisible();
  await specific(page, "Finish").selectOption("Gloss");
  await expectCurrentFields(page);
  await expect(specific(page, "Finish")).toHaveValue("Gloss");
});

test("upload missing-specifics errors retain edits and allow a corrected retry", async ({ page, editor }) => {
  editor.uploadOutcome = "missing-specifics";
  await editor.open();
  await editCurrentFields(page);
  await page.getByRole("button", { name: "Save & Import", exact: true }).click();
  await expect(page.getByText("Please supply required Finish", { exact: true })).toBeVisible();
  await expect(specific(page, "Finish")).toBeVisible();
  await specific(page, "Finish").selectOption("Gloss");
  await expectCurrentFields(page);
  editor.uploadOutcome = "queued";
  await page.getByRole("button", { name: "Save & Import", exact: true }).click();
  await expect.poll(() => editor.requests.filter(request => request.path === "/api/upload").length).toBe(2);
  expect(editor.saves[1].itemSpecifics).toMatchObject({ Finish: "Gloss", Author: "Alex Example", Material: "Cotton" });
});

test("duplicate import clicks during preparation produce one save and upload", async ({ page, editor }) => {
  await editor.open();
  await expect.poll(() => editor.requests.filter(request => request.path === "/api/ebay/category-aspects").length).toBeGreaterThan(0);
  let release!: () => void;
  editor.requirementsReady = new Promise<void>(resolve => { release = resolve; });
  try {
    const before = editor.requests.filter(request => request.path === "/api/ebay/category-aspects").length;
    await page.getByRole("button", { name: "Save & Import", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => editor.requests.filter(request => request.path === "/api/ebay/category-aspects").length).toBeGreaterThan(before);
    await expect(page.getByRole("button", { name: /Preparing…/ })).toBeDisabled();
    expect(editor.saves).toHaveLength(0);
    release();
    await expect.poll(() => editor.requests.filter(request => request.path === "/api/upload").length).toBe(1);
    expect(editor.saves).toHaveLength(1);
  } finally { release(); }
});

test("restored active uploads disable another import without saving again", async ({ page, editor }) => {
  editor.currentJobs = [queuedJob()];
  await editor.open();
  await expect(page.getByRole("button", { name: "Save & Import", exact: true })).toBeDisabled();
  expect(editor.saves).toHaveLength(0);
  expect(editor.requests.filter(request => request.path === "/api/upload")).toHaveLength(0);
});

test("a failed save preserves edits and prevents an upload until retry succeeds", async ({ page, editor }) => {
  editor.saveFails = true;
  await editor.open();
  await editCurrentFields(page);
  await page.getByRole("button", { name: "Save & Import", exact: true }).click();
  await expect(page.getByText("Synthetic save failure", { exact: true })).toBeVisible();
  expect(editor.requests.filter(request => request.path === "/api/upload")).toHaveLength(0);
  await expectCurrentFields(page);
  editor.saveFails = false;
  await page.getByRole("button", { name: "Save & Import", exact: true }).click();
  await expect.poll(() => editor.requests.filter(request => request.path === "/api/upload").length).toBe(1);
  expect(editor.saves).toHaveLength(2);
});


test("reopening a draft restores shipping confirmation and retry starts the existing upload workflow", async ({page, editor}) => {
  const shippingConfirmation = {sourceJobId: "previous-attempt", productId, nonce: "server-challenge", message: "Delivery unverified"};
  editor.currentJobs = [{...queuedJob(), id: "previous-attempt", status: "COMPLETED", processed: 1, failed: 1, errors: [{productId, error: "Delivery unverified", shippingConfirmation}]}];
  await editor.open();
  await expect(page.getByRole("region", {name: "Shipping confirmation"})).toBeVisible();
  await page.getByRole("button", {name: "Retry check", exact: true}).click();
  await expect(page.getByRole("region", {name: "Shipping confirmation"})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Save & Import", exact: true})).toBeDisabled();
  expect(editor.saves).toHaveLength(0);
  expect(editor.requests.filter(request => request.path === "/api/upload")).toHaveLength(1);
});

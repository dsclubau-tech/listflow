import { expect, test, type Page } from "playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import type { BulkEditJob } from "../../hooks/useBulkEditJob";

const styles = postcss([tailwindcss()]).process(fs.readFileSync("app/globals.css", "utf8"), {
  from: path.resolve("app/globals.css"),
}).then(result => result.css);

const harness = build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import BulkEditModal from "./components/BulkEditModal";
    import BulkEditProgressCard, { BulkEditJobControl } from "./components/BulkEditProgressCard";
    import NotificationStack from "./components/NotificationStack";
    import Toast from "./components/Toast";
    import { useToast } from "./hooks/useToast";
    import { useBulkEditJob } from "./hooks/useBulkEditJob";
    const state = { refreshes: 0, toasts: [], clicks: 0 };
    function App() {
      const [open, setOpen] = React.useState(false);
      const [mounted, setMounted] = React.useState(false);
      const [view, setView] = React.useState("editor");
      const [store, setStore] = React.useState("store-a");
      const [count, setCount] = React.useState(50);
      const focus = React.useRef(null);
      const { toast, showToast, hideToast } = useToast();
      const close = React.useCallback(() => setOpen(false), []);
      const notify = React.useCallback((message, variant) => { state.toasts.push(message); showToast(message, variant); }, [showToast]);
      const completed = React.useCallback(job => { state.refreshes++; close(); notify("Bulk edit finished with " + job.failed + " failed listings.", job.failed ? "error" : "success"); }, [close, notify]);
      const tracking = useBulkEditJob(store, completed);
      const details = React.useCallback(() => {
        focus.current = document.activeElement;
        tracking.hidePreview(); setMounted(true); setView("job"); setOpen(true);
      }, [tracking.hidePreview]);
      window.bulkHarness.setCount = setCount;
      window.bulkHarness.setStore = setStore;
      return <>
        <BulkEditJobControl job={tracking.job} onOpen={details} />
        <button disabled={!count} onClick={() => { focus.current = document.activeElement; setMounted(true); setView("editor"); setOpen(true); }}>Bulk Edit selected</button>
        <button onClick={() => state.clicks++}>Product row</button>
        <input aria-label="Search products" />
        <button onClick={() => state.clicks++}>Next page</button>
        {mounted && <BulkEditModal open={open} view={view} storeId={store} selectedProductIds={Array.from({length: count}, (_, i) => store + "-product-" + i)}
          onClose={close} onToast={notify} tracking={tracking} returnFocusRef={focus} />}
        <NotificationStack>
          {tracking.previewVisible && tracking.job && <BulkEditProgressCard job={tracking.job} onClose={tracking.hidePreview} onView={details} />}
          {toast.visible && <Toast key={toast.id} position="inline" message={toast.message} variant={toast.variant} onClose={hideToast} />}
        </NotificationStack>
      </>;
    }
    const root = createRoot(document.getElementById("root"));
    const render = () => root.render(<React.StrictMode><App /></React.StrictMode>);
    window.bulkHarness = { state, navigateAway() { root.render(<p>Another page</p>); }, returnToProducts: render };
    render();
  ` },
  bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
}).then(result => result.outputFiles[0].text);

declare global {
  interface Window {
    bulkHarness: {
      state: { refreshes: number; toasts: string[]; clicks: number };
      navigateAway(): void;
      returnToProducts(): void;
      setCount(count: number): void;
      setStore(storeId: string): void;
    };
  }
}
const endedError = 'You are not allowed to revise an ended item "307038451893"; FixedPrice item ended; B00VZYR6UC';
const makeJob = (overrides: Partial<BulkEditJob> = {}): BulkEditJob => ({
  id: "bulk-job-1", storeId: "store-a", type: "BULK_EDIT_REVISE", status: "QUEUED", total: 37,
  processed: 0, succeeded: 0, failed: 0, errors: [], completedAt: null, updatedAt: "2026-10-01T01:00:00Z", ...overrides,
});
const unexpectedByPage=new WeakMap<Page,string[]>();
test.afterEach(async({page})=>{expect(unexpectedByPage.get(page)??[]).toEqual([]);});
type Submission = { productIds: string[]; requestId: string; operations: unknown[] };
async function start(page: Page, restored?: BulkEditJob, options: { holdRestore?: boolean; missingReference?: boolean } = {}) {
  const unexpected:string[]=[];unexpectedByPage.set(page,unexpected);
  page.on("pageerror",error=>unexpected.push("Runtime error: "+error.message));
  await page.route("**/*",async route=>{unexpected.push("Unexpected external request: "+route.request().url());await route.abort();});
  await page.clock.install({ time: new Date("2026-10-01T01:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-01T01:00:01Z"));
  const jobs = new Map<string, BulkEditJob>();
  if (restored && !options.missingReference) jobs.set(restored.id, restored);
  const requests: Submission[] = [];
  const controls = { jobReads: 0, total: 37, retries: 0, retryError: null as string | null, holdPost: false, postError: null as string | null,
    releasePost: () => {}, holdRestore: options.holdRestore === true, releaseRestore: () => {} };
  const heldRestorations: Array<() => void> = [];
  controls.releaseRestore = () => heldRestorations.splice(0).forEach(resolve => resolve());
  const css = await styles;
  await page.route("http://localhost/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") {
      await route.fulfill({ contentType: "text/html", body: `<html><head><style>${css}</style></head><body><div id="root"></div></body></html>` }); return;
    }
    if (path === "/api/worker/status") {
      await route.fulfill({ json: { workers: [{ online: true, capabilities: ["durable-bulk-edit-v1"] }] } });
    } else if (path === "/api/products/bulk-edit") {
      const body = route.request().postDataJSON() as Submission;
      requests.push(body);
      if (controls.holdPost) await new Promise<void>(resolve => { controls.releasePost = resolve; });
      if (controls.postError) { await route.fulfill({ status: 500, json: { error: controls.postError } }); return; }
      const accepted = makeJob({ total: controls.total, id: `bulk-job-${requests.length}`, storeId: body.productIds[0]?.startsWith("store-b") ? "store-b" : "store-a" });
      jobs.set(accepted.id, accepted);
      await route.fulfill({ status: 202, json: { job: accepted, skipped: Array.from({ length: Math.max(0, body.productIds.length - accepted.total) }, (_, i) => ({ productId: `skipped-${i}`, title: `Skipped product ${i}`, reason: "Not eligible" })) } });
    } else if (path.endsWith("/retry")) {
      controls.retries++;
      if (controls.retryError) { await route.fulfill({ status: 409, json: { error: controls.retryError } }); return; }
      const id = path.split("/").at(-2)!;
      const previous = jobs.get(id)!;
      const queued = { ...previous, status: "QUEUED" as const, processed: previous.succeeded, failed: 0, errors: [], completedAt: null };
      jobs.set(id, queued);
      await route.fulfill({ status: 202, json: { job: queued } });
    } else if (path.startsWith("/api/products/bulk-edit/jobs/")) {
      controls.jobReads++;
      const id = path.split("/").at(-1)!;
      const snapshot = jobs.get(id);
      if (controls.holdRestore && id === restored?.id) await new Promise<void>(resolve => { heldRestorations.push(resolve); });
      await route.fulfill({ status: snapshot ? 200 : 404, json: snapshot ? { job: snapshot } : { error: "Job not found" } }).catch(() => {});
    } else {unexpected.push("Unexpected request: "+route.request().url());await route.abort();}
  });
  await page.goto("http://localhost/");
  if (restored) await page.evaluate(value => localStorage.setItem(`listflow:bulk-edit-job:${value.storeId}`, value.id), restored);
  await page.addScriptTag({ content: await harness });
  await expect(page.getByRole("button", { name: "Bulk Edit selected" })).toBeVisible();
  return { jobs, requests, controls };
}
async function submit(page: Page) {
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await page.getByRole("button", { name: "Add item to edit" }).click();
  await page.getByRole("button", { name: "Fees %", exact: true }).click();
  await page.getByRole("button", { name: "Update", exact: true }).click();
}
async function finish(page: Page, jobs: Map<string, BulkEditJob>, overrides: Partial<BulkEditJob> = {}) {
  jobs.set("bulk-job-1", makeJob({ status: "COMPLETED", processed: 37, succeeded: 36, failed: 1,
    errors: [{ productId: "failed-product", title: "Ended listing", error: endedError }], completedAt: "2026-10-01T01:01:00Z", ...overrides }));
  await expect.poll(async () => {
    await page.clock.fastForward(2000);
    return page.getByRole("button", { name: "Bulk edit results" }).count();
  }).toBe(1);
}

test("acceptance closes the editor immediately and progress expires exactly once after five seconds", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bulk Edit selected" })).toBeFocused();
  await page.getByRole("button", { name: "Product row" }).click();
  await page.getByRole("textbox", { name: "Search products" }).fill("Still clickable");
  await page.getByRole("button", { name: "Next page" }).click();
  expect(await page.evaluate(() => window.bulkHarness.state.clicks)).toBe(2);
  backend.jobs.set("bulk-job-1", makeJob({ status: "RUNNING", processed: 3, succeeded: 3 }));
  await page.clock.fastForward(2_000);
  await expect(page.getByText("3/37 processed (3 succeeded, 0 failed)")).toBeVisible();
  await page.clock.fastForward(2_999);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toBeVisible();
  await page.clock.fastForward(1);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  const reads = backend.controls.jobReads;
  await page.clock.fastForward(10_000);
  await expect.poll(() => backend.controls.jobReads).toBeGreaterThan(reads);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-a"))).toBe("bulk-job-1");
  await page.evaluate(() => window.bulkHarness.setCount(0));
  await page.getByRole("button", { name: "Bulk edit progress", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit Progress (37 products)");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
});

test("X hides active progress immediately without stopping processing or removing tracking", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await page.getByRole("button", { name: "Close progress notification" }).click();
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  const reads = backend.controls.jobReads;
  backend.jobs.set("bulk-job-1", makeJob({ status: "RUNNING", processed: 12, succeeded: 12 }));
  await page.clock.fastForward(2_000);
  await expect.poll(() => backend.controls.jobReads).toBeGreaterThan(reads);
  await page.getByRole("button", { name: "Bulk edit progress", exact: true }).click();
  await expect(page.getByText("12/37 processed (12 succeeded, 0 failed)")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeFocused();
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  await finish(page, backend.jobs);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.bulkHarness.state.refreshes)).toBe(1);
});

test("viewing progress consumes the preview and closing details never restores it", async ({ page }) => {
  await start(page);
  await submit(page);
  await page.getByRole("button", { name: "View progress", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  await page.getByRole("button", { name: "Close bulk edit" }).click();
  await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeFocused();
  await page.clock.fastForward(20_000);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
});

test("partial completion keeps results and retries accessible without a persistent card", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeVisible();
  await finish(page, backend.jobs);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Bulk edit results", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit Results (37 products)");
    await expect(page.getByText(endedError, { exact: false })).toBeVisible();
    await expect(page.getByText("Skipped 13 products", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
    await expect(page.getByText("Add at least one item to edit.")).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  expect(await page.evaluate(() => window.bulkHarness.state.refreshes)).toBe(1);
  expect(await page.evaluate(() => window.bulkHarness.state.toasts)).toHaveLength(1);
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit (50 products)");
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
});

for (const status of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
  test(`${status} notifies once and releases results locally`, async ({ page }) => {
    const backend = await start(page);
    await submit(page);
    await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeVisible();
    await finish(page, backend.jobs, { status, succeeded: status === "FAILED" ? 0 : 37, failed: status === "FAILED" ? 37 : 0, errors: [] });
    await page.getByRole("button", { name: "Bulk edit results", exact: true }).click();
    await page.getByRole("button", { name: "Dismiss results" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-a"))).toBeNull();
    expect(backend.jobs.has("bulk-job-1")).toBe(true);
    expect(await page.evaluate(() => window.bulkHarness.state.refreshes)).toBe(1);
  });
}

for (const count of [500, 501, 812, 1_000, 10_000]) {
  test(`all ${count} selected products are sent in one submission`, async ({ page }) => {
    const backend = await start(page);
    backend.controls.total = count;
    await page.evaluate(value => window.bulkHarness.setCount(value), count);
    await submit(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeVisible();
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0].productIds).toHaveLength(count);
    expect(new Set(backend.requests[0].productIds).size).toBe(count);
    await page.getByRole("button", { name: "View progress", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(`Bulk Edit Progress (${count} products)`);
  });
}

test("812-product Bella Vista location edit submits the exact saved locality", async ({ page }) => {
  const backend = await start(page);
  backend.controls.total = 812;
  await page.evaluate(() => window.bulkHarness.setCount(812));
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await page.getByRole("button", { name: "Add item to edit" }).click();
  await page.getByRole("button", { name: "Location eBay", exact: true }).click();
  await page.getByPlaceholder("Postcode").fill("2153");
  await page.getByRole("combobox").nth(1).selectOption("Bella Vista");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeVisible();
  expect(backend.requests[0].operations).toEqual([{ field: "location", value: { location: "Australia", postalCode: "2153", locationText: "Bella Vista, NSW" } }]);
});

for (const status of ["RUNNING", "COMPLETED"] as const) {
  test(`restored ${status} is accessible without selecting rows or replaying a preview`, async ({ page }) => {
    await start(page, makeJob({ status, completedAt: status === "COMPLETED" ? "2026-10-01T01:01:00Z" : null }));
    const control = status === "RUNNING" ? "Bulk edit progress" : "Bulk edit results";
    await expect(page.getByRole("button", { name: control, exact: true })).toBeVisible();
    await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
    expect(await page.evaluate(() => window.bulkHarness.state)).toMatchObject({ refreshes: 0, toasts: [] });
    await page.evaluate(() => window.bulkHarness.setCount(0));
    await page.getByRole("button", { name: control, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(status === "RUNNING" ? /Progress/ : /Results/);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  });
}

test("reload and navigation do not replay a previously shown preview", async ({ page }) => {
  await start(page);
  await submit(page);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toBeVisible();
  await page.reload();
  await page.addScriptTag({ content: await harness });
  await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeVisible();
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  await page.evaluate(() => window.bulkHarness.navigateAway());
  await expect(page.getByText("Another page")).toBeVisible();
  await page.evaluate(() => window.bulkHarness.returnToProducts());
  await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeVisible();
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
});

test("failed retry remains usable and an accepted retry gets a fresh five-second preview", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await expect(page.getByRole("button", { name: "Bulk edit progress", exact: true })).toBeVisible();
  await finish(page, backend.jobs, {errors:[{productId:"failed-product",title:"Temporary error",error:"eBay temporarily unavailable",retryEligible:true}]});
  await page.getByRole("button", { name: "Bulk edit results", exact: true }).click();
  backend.controls.retryError = "Worker unavailable; try again later";
  await page.getByRole("button", { name: "Retry 1 failed" }).click();
  await expect(page.getByRole("alert")).toHaveText("Worker unavailable; try again later");
  await expect(page.getByRole("button", { name: "Retry 1 failed" })).toBeEnabled();
  backend.controls.retryError = null;
  await page.getByRole("button", { name: "Retry 1 failed" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toBeVisible();
  await expect(page.getByText("36/37 processed (36 succeeded, 0 failed)")).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  await finish(page, backend.jobs, { succeeded: 37, failed: 0, errors: [], completedAt: "2026-10-01T01:02:00Z" });
  expect(backend.requests).toHaveLength(1);
  expect(backend.controls.retries).toBe(2);
  expect(await page.evaluate(() => window.bulkHarness.state.refreshes)).toBe(2);
});

test("pending submission retains its request identity while the dialog is closed and reopened", async ({ page }) => {
  const backend = await start(page);
  backend.controls.holdPost = true;
  await submit(page);
  await expect.poll(() => backend.requests.length).toBe(1);
  await page.getByRole("button", { name: "Close bulk edit" }).click();
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Updating...", exact: true })).toBeDisabled();
  backend.controls.releasePost();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toBeVisible();
  expect(backend.requests).toHaveLength(1);
});

test("submission error keeps the editor usable and retry sends the same request ID", async ({ page }) => {
  const backend = await start(page);
  backend.controls.postError = "Network interrupted";
  await submit(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Network interrupted");
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit (50 products)");
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
  backend.controls.postError = null;
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-bulk-edit-progress-card]")).toBeVisible();
  expect(backend.requests).toHaveLength(2);
  expect(backend.requests[0].requestId).toBe(backend.requests[1].requestId);
});

test("old-store responses cannot attach a job or resurrect its preview in the new store", async ({ page }) => {
  const backend = await start(page);
  backend.controls.holdPost = true;
  await submit(page);
  await expect.poll(() => backend.requests.length).toBe(1);
  await page.evaluate(() => window.bulkHarness.setStore("store-b"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  backend.controls.releasePost();
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-b"))).toBeNull();
});

test("late terminal restoration cannot close a fresh editor or replay notification", async ({ page }) => {
  const backend = await start(page, makeJob({ status: "COMPLETED", completedAt: "2026-10-01T01:01:00Z" }), { holdRestore: true });
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeDisabled();
  backend.controls.holdRestore = false;
  backend.controls.releaseRestore();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit (50 products)");
  expect(await page.evaluate(() => window.bulkHarness.state)).toMatchObject({ refreshes: 0, toasts: [] });
});

test("unavailable references are removed and skipped result details survive reload", async ({ page }) => {
  await start(page, makeJob(), { missingReference: true });
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-a"))).toBeNull();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await page.getByRole("button", { name: "Add item to edit" }).click();
  await page.getByRole("button", { name: "Fees %", exact: true }).click();
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.addScriptTag({ content: await harness });
  await page.getByRole("button", { name: "Bulk edit progress", exact: true }).click();
  await expect(page.getByText("Skipped 13 products", { exact: true })).toBeVisible();
});

for (const width of [320, 390, 1600]) {
  test(`temporary card and toast do not overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const backend = await start(page);
    backend.controls.postError = "Initial request interrupted";
    await submit(page);
    await expect(page.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
    backend.controls.postError = null;
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page.locator("[data-bulk-edit-progress-card]")).toBeVisible();
    const card = await page.locator("[data-bulk-edit-progress-card]").boundingBox();
    const toast = await page.getByRole("status").boundingBox();
    expect(card && toast && card.y + card.height <= toast.y).toBeTruthy();
    expect(card && card.x >= 0 && card.x + card.width <= width).toBeTruthy();
    await page.getByRole("button", { name: "View progress", exact: true }).click();
    await page.getByRole("dialog").locator("..").click({ position: { x: 1, y: 1 } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-bulk-edit-progress-card]")).toHaveCount(0);
  });
}
for(const width of [1440,390]){
 test("variation results distinguish partial updates, verification and ended listings at "+width,async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.setViewportSize({width,height:900});
  const job=makeJob({status:"COMPLETED",total:411,processed:411,succeeded:405,failed:6,completedAt:"2026-10-01T01:02:00Z",errors:[
   {productId:"baboni",title:"Baboni",error:"2 of 3 variations updated; Medium could not be updated.",outcomeUncertain:true,retryEligible:true,
    variationResults:[{state:"CONFIRMED",target:{sku:"B09682CXNR"}},{state:"CONFIRMED",target:{sku:"B0CNCRBRM1"}},{state:"UNCERTAIN",target:{sku:"B0CNCP33BQ"},error:"Readback unavailable"}]},
   {productId:"ended",title:"Ended listing",error:"This eBay listing has ended.",retryEligible:false},
   ...Array.from({length:4},(_,i)=>({productId:"retry"+i,title:"Retry "+i,error:"Temporary failure",retryEligible:true}))
  ]});
  const backend=await start(page,job);
  await expect(page.getByRole("button",{name:"Bulk edit results",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Bulk edit results",exact:true}).click();
  await expect(page.getByText("411/411 processed (405 succeeded, 5 failed, 1 need verification)")).toBeVisible();
  await expect(page.getByText("Update result needs verification.",{exact:true})).toBeVisible();
  await page.getByText("Variation details",{exact:true}).click();
  await expect(page.getByText("B09682CXNR: confirmed")).toBeVisible();
  await expect(page.getByText("This eBay listing has ended.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Verify pending updates"})).toBeEnabled();
  await page.getByRole("button",{name:"Verify pending updates"}).dblclick();
  expect(backend.controls.retries).toBe(1);expect(errors).toEqual([]);
 });
}
test("ended listing alone has no retry control",async({page})=>{
 const job=makeJob({status:"COMPLETED",processed:37,succeeded:36,failed:1,completedAt:"2026-10-01T01:02:00Z",errors:[{productId:"ended",title:"Ended",error:"This eBay listing has ended.",retryEligible:false}]});
 const backend=await start(page,job);await page.getByRole("button",{name:"Bulk edit results",exact:true}).click();
 await expect(page.getByRole("button",{name:/Retry .* failed|Verify pending/})).toHaveCount(0);expect(backend.controls.retries).toBe(0);
});

for(const width of [1440,390])test("deferred pricing and parent repair remain action required at "+width,async({page})=>{
 await page.setViewportSize({width,height:900});
 const job=makeJob({status:"COMPLETED",total:411,processed:411,succeeded:409,failed:2,completedAt:"2026-10-07T01:00:00Z",errors:[
  {productId:"waiting",title:"Zero-stock variation",error:"Price update waiting for stock restoration.",awaitingRestoration:1,retryEligible:false,variationResults:[{state:"DEFERRED",target:{sku:"EXACT-SKU"},error:"Price update waiting for stock restoration."}]},
  {productId:"repair",title:"De’Longhi",error:"Parent SKU repair required.",retryEligible:false,blockerCode:"PARENT_VARIATION_SKU_COLLISION",variationResults:[{state:"REJECTED",target:{sku:"B07G5B97VD"},errors:[{code:"21916735",message:"Variation SKU required",shortMessage:"Item-level SKU supplied",longMessage:"Variation level SKU required"}]}]}
 ]});
 const backend=await start(page,job);await page.getByRole("button",{name:"Bulk edit results",exact:true}).click();
 await expect(page.getByText("411/411 processed (409 succeeded, 1 failed, 1 awaiting restoration)")).toBeVisible();
 await expect(page.getByText("Price update waiting for stock restoration.",{exact:true}).first()).toBeVisible();
 await expect(page.getByRole("button",{name:/Retry .* failed|Verify pending/})).toHaveCount(0);
 await page.getByText("Variation details",{exact:true}).last().click();await expect(page.getByText(/21916735.*Item-level SKU supplied/)).toBeVisible();
 expect(backend.controls.retries).toBe(0);
 await page.reload();await page.addScriptTag({content:await harness});await page.getByRole("button",{name:"Bulk edit results",exact:true}).click();
 await expect(page.getByText("411/411 processed (409 succeeded, 1 failed, 1 awaiting restoration)")).toBeVisible();
});

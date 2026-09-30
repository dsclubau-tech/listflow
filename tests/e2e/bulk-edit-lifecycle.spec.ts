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
    import NotificationStack from "./components/NotificationStack";
    import Toast from "./components/Toast";
    import { useToast } from "./hooks/useToast";
    const state = { refreshes: 0, toasts: [], clicks: 0 };
    function App() {
      const [open, setOpen] = React.useState(false);
      const [view, setView] = React.useState("editor");
      const [store, setStore] = React.useState("store-a");
      const [count, setCount] = React.useState(50);
      const [container, setContainer] = React.useState(null);
      const { toast, showToast, hideToast } = useToast();
      const close = React.useCallback(() => setOpen(false), []);
      const details = React.useCallback(() => { setView("job"); setOpen(true); }, []);
      const notify = React.useCallback((message, variant) => { state.toasts.push(message); showToast(message, variant); }, [showToast]);
      window.bulkHarness.setCount = setCount;
      window.bulkHarness.setStore = setStore;
      return <>
        <button onClick={() => { setView("editor"); setOpen(true); }}>Bulk Edit selected</button>
        <button onClick={() => state.clicks++}>Product row</button>
        <input aria-label="Search products" />
        <button onClick={() => state.clicks++}>Next page</button>
        <BulkEditModal open={open} view={view} storeId={store} selectedProductIds={Array.from({length: count}, (_, i) => store + "-product-" + i)}
          onClose={close} onOpen={details} onToast={notify} notificationContainer={container} />
        <NotificationStack ref={setContainer}>{toast.visible && <Toast key={toast.id} position="inline" message={toast.message} variant={toast.variant} onClose={hideToast} />}</NotificationStack>
      </>;
    }
    window.bulkHarness = { state, router: { refresh() { state.refreshes++; } } };
    const root = createRoot(document.getElementById("root"));
    root.render(<React.StrictMode><App /></React.StrictMode>);
  ` },
  bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
  plugins: [{ name: "router", setup(build) {
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "mock" }));
    build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export function useRouter() { return window.bulkHarness.router; }" }));
  } }],
}).then(result => result.outputFiles[0].text);

declare global {
  interface Window {
    bulkHarness: {
      state: { refreshes: number; toasts: string[]; clicks: number };
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
type Submission = { productIds: string[]; requestId: string; operations: unknown[] };
async function start(page: Page, restored?: BulkEditJob, options: { holdRestore?: boolean; missingReference?: boolean } = {}) {
  page.on("pageerror", error => console.error("Browser error:", error.message));
  await page.clock.install();
  const jobs = new Map<string, BulkEditJob>();
  if (restored && !options.missingReference) jobs.set(restored.id, restored);
  const requests: Submission[] = [];
  const controls = { retries: 0, retryError: null as string | null, holdPost: false, postError: null as string | null,
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
      const accepted = makeJob({ id: `bulk-job-${requests.length}`, storeId: body.productIds[0]?.startsWith("store-b") ? "store-b" : "store-a" });
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
      const id = path.split("/").at(-1)!;
      const snapshot = jobs.get(id);
      if (controls.holdRestore && id === restored?.id) await new Promise<void>(resolve => { heldRestorations.push(resolve); });
      await route.fulfill({ status: snapshot ? 200 : 404, json: snapshot ? { job: snapshot } : { error: "Job not found" } }).catch(() => {});
    } else await route.fulfill({ status: 404, json: {} });
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
  await page.clock.fastForward(2000);
  await expect(page.getByRole("button", { name: "View results" })).toBeVisible();
}

test("partial completion closes, releases clicks, preserves results and allows a fresh 50-product edit", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit Progress (37 products)");
  await finish(page, backend.jobs);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bulk Edit selected" })).toBeFocused();
  await page.getByRole("button", { name: "Product row" }).click();
  await page.getByRole("textbox", { name: "Search products" }).fill("Still clickable");
  await page.getByRole("button", { name: "Next page" }).click();
  expect(await page.evaluate(() => window.bulkHarness.state.clicks)).toBe(2);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "View results" }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit Results (37 products)");
    await expect(page.getByText(endedError, { exact: false })).toBeVisible();
    await expect(page.getByText("Skipped 13 products", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
    await expect(page.getByText("Add at least one item to edit.")).toHaveCount(0);
    await page.getByRole("button", { name: "Close bulk edit" }).click();
    await expect(page.getByRole("button", { name: "View results" })).toBeFocused();
  }
  expect(await page.evaluate(() => window.bulkHarness.state.refreshes)).toBe(1);
  expect((await page.evaluate(() => window.bulkHarness.state.toasts)).filter(message => message.startsWith("Bulk edit finished"))).toHaveLength(1);
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit (50 products)");
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  await page.getByRole("button", { name: "Add item to edit" }).click();
  await page.getByRole("button", { name: "Quantity", exact: true }).click();
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
});
for (const status of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
  test(`${status} releases the modal and remains inspectable`, async ({ page }) => {
    const backend = await start(page);
    await submit(page);
    await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
    await finish(page, backend.jobs, { status, succeeded: status === "FAILED" ? 0 : 37, failed: status === "FAILED" ? 37 : 0, errors: [] });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.bulkHarness.state.refreshes)).toBe(1);
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(page.locator("[data-bulk-edit-result-card]")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-a"))).toBeNull();
  });
}
test("restored failed results do not notify or lock a fresh editor", async ({ page }) => {
  await start(page, makeJob({ status: "COMPLETED", processed: 37, succeeded: 36, failed: 1, completedAt: "2026-10-01T01:01:00Z" }));
  await expect(page.getByRole("button", { name: "View results" })).toBeVisible();
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  expect(await page.evaluate(() => window.bulkHarness.state)).toMatchObject({ refreshes: 0, toasts: [] });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("active restored job blocks duplicates, closes in background, then permits new selection", async ({ page }) => {
  const backend = await start(page, makeJob({ status: "RUNNING" }));
  await expect(page.getByRole("button", { name: "View progress" })).toBeVisible();
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  await expect(page.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => window.bulkHarness.setCount(10));
  await finish(page, backend.jobs);
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit (10 products)");
});
test("failed retry remains actionable and successful retry notifies again for the same job", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  await finish(page, backend.jobs);
  await page.getByRole("button", { name: "View results" }).click();
  backend.controls.retryError = "Worker unavailable; try again later";
  await page.getByRole("button", { name: "Retry 1 failed" }).click();
  await expect(page.getByRole("alert")).toHaveText("Worker unavailable; try again later");
  await expect(page.getByRole("button", { name: "Retry 1 failed" })).toBeEnabled();
  backend.controls.retryError = null;
  await page.getByRole("button", { name: "Retry 1 failed" }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  await expect(page.getByText("36/37 processed (36 succeeded, 0 failed)")).toBeVisible();
  await finish(page, backend.jobs, { succeeded: 37, failed: 0, errors: [], completedAt: "2026-10-01T01:02:00Z" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backend.requests).toHaveLength(1);
  expect(backend.controls.retries).toBe(2);
  expect(await page.evaluate(() => window.bulkHarness.state.refreshes)).toBe(2);
});
test("closing during submission keeps it pending and does not reopen the modal", async ({ page }) => {
  const backend = await start(page);
  backend.controls.holdPost = true;
  await submit(page);
  await expect.poll(() => backend.requests.length).toBe(1);
  await page.getByRole("button", { name: "Close bulk edit" }).click();
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Updating...", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  backend.controls.releasePost();
  await expect(page.getByRole("button", { name: "View progress" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backend.requests).toHaveLength(1);
});
test("uncertain submission retry uses the same request ID", async ({ page }) => {
  const backend = await start(page);
  backend.controls.postError = "Network interrupted";
  await submit(page);
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
  backend.controls.postError = null;
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  expect(backend.requests).toHaveLength(2);
  expect(backend.requests[0].requestId).toBe(backend.requests[1].requestId);
});
test("old-store submission cannot reopen or attach its job to the new store", async ({ page }) => {
  const backend = await start(page);
  backend.controls.holdPost = true;
  await submit(page);
  await expect.poll(() => backend.requests.length).toBe(1);
  await page.evaluate(() => window.bulkHarness.setStore("store-b"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  backend.controls.releasePost();
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-b"))).toBeNull();
  expect(await page.evaluate(() => window.bulkHarness.state.refreshes)).toBe(0);
});
for (const width of [320, 390, 1600]) {
  test(`notification stack has no overlap at ${width}px and backdrop closes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const backend = await start(page);
    await submit(page);
    await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
    await finish(page, backend.jobs);
    const card = await page.locator("[data-bulk-edit-result-card]").boundingBox();
    const toast = await page.getByRole("status").boundingBox();
    expect(card && toast && card.y + card.height <= toast.y).toBeTruthy();
    expect(card && card.x >= 0 && card.x + card.width <= width).toBeTruthy();
    await page.getByRole("button", { name: "View results" }).click();
    await page.getByRole("dialog").locator("..").click({ position: { x: 1, y: 1 } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
test("a late restored terminal result cannot close the fresh editor", async ({ page }) => {
  const backend = await start(page, makeJob({ status: "COMPLETED", completedAt: "2026-10-01T01:01:00Z" }), { holdRestore: true });
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeDisabled();
  backend.controls.holdRestore = false;
  backend.controls.releaseRestore();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit (50 products)");
  expect(await page.evaluate(() => window.bulkHarness.state)).toMatchObject({ refreshes: 0, toasts: [] });
});

test("a late restoration from the previous store is ignored", async ({ page }) => {
  const backend = await start(page, makeJob({ status: "RUNNING" }), { holdRestore: true });
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeDisabled();
  await page.evaluate(() => window.bulkHarness.setStore("store-b"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  backend.controls.holdRestore = false;
  backend.controls.releaseRestore();
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Bulk Edit (50 products)");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-bulk-edit-result-card]")).toHaveCount(0);
  expect(await page.evaluate(() => window.bulkHarness.state)).toMatchObject({ refreshes: 0, toasts: [] });
});

test("unavailable saved job references are discarded without clearing browser storage manually", async ({ page }) => {
  await start(page, makeJob(), { missingReference: true });
  await page.getByRole("button", { name: "Bulk Edit selected" }).click();
  await expect(page.getByRole("button", { name: "Add item to edit" })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-a"))).toBeNull();
  await expect(page.locator("[data-bulk-edit-result-card]")).toHaveCount(0);
});

test("a newly accepted job replaces the previous result without deleting its record", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  await finish(page, backend.jobs);
  await submit(page);
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  expect(backend.jobs.has("bulk-job-1")).toBe(true);
  expect(backend.requests).toHaveLength(2);
  expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-a"))).toBe("bulk-job-2");
});
test("completed results preserve skipped details across reload without replaying completion", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  await finish(page, backend.jobs);
  await page.reload();
  await page.addScriptTag({ content: await harness });
  await expect(page.getByRole("button", { name: "View results" })).toBeVisible();
  await page.getByRole("button", { name: "View results" }).click();
  await expect(page.getByText("Skipped 13 products", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.bulkHarness.state)).toMatchObject({ refreshes: 0, toasts: [] });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("listflow:bulk-edit-job:store-a:skipped"))).toBeNull();
});
test("a new operation does not inherit an earlier result's retry error", async ({ page }) => {
  const backend = await start(page);
  await submit(page);
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  await finish(page, backend.jobs);
  await page.getByRole("button", { name: "View results" }).click();
  backend.controls.retryError = "Worker unavailable; try again later";
  await page.getByRole("button", { name: "Retry 1 failed" }).click();
  await expect(page.getByRole("alert")).toHaveText("Worker unavailable; try again later");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await submit(page);
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/Progress/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
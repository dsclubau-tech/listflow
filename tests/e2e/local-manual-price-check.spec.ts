import { expect, test } from "playwright/test";
import { fork, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const enabled = process.env.LISTFLOW_RUN_LOCAL_MANUAL_CHECK_TEST === "1";
const asins = (process.env.LISTFLOW_E2E_PRODUCT_ASINS || "B0B4ZSR2PX,B0029U2YSA").split(",").map(x => x.trim());
// Live credentials must never be recorded in traces, videos, or login screenshots.
test.use({ trace: "off", video: "off", screenshot: "off" });

type WorkerMessage = { type: string; message?: string; [key: string]: unknown };
function waitForMessage(child: ChildProcess, kind: string, timeout: number): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(deadline); child.off("message", receive); child.off("exit", exited); };
    const receive = (raw: unknown) => {
      const message = raw as WorkerMessage;
      if (message.type === "error") { cleanup(); reject(new Error(message.message)); }
      else if (message.type === kind) { cleanup(); resolve(message); }
    };
    const exited = (code: number | null) => { cleanup(); reject(new Error(`Local test worker exited (${code}) before ${kind}.`)); };
    const deadline = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for worker ${kind}.`)); }, timeout);
    child.on("message", receive);
    child.once("exit", exited);
  });
}

test.describe("Step 4: real selected manual price check", () => {
  test.skip(!enabled, "Opt in with LISTFLOW_RUN_LOCAL_MANUAL_CHECK_TEST=1; this runs a real saved price check.");
  // Never retry this live mutation automatically, even in CI.
  test.describe.configure({ retries: 0 });

  test("select Products rows, queue only those products, and verify the real local job", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(420_000);
    const storeLogin = process.env.LISTFLOW_E2E_STORE_ID;
    const password = process.env.LISTFLOW_E2E_STORE_PASSWORD;
    expect(storeLogin, "Supply the store login at runtime.").toBeTruthy();
    expect(password, "Supply its password at runtime.").toBeTruthy();
    expect([2, 3, 5]).toContain(asins.length);
    expect(new Set(asins).size).toBe(asins.length);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);

    await page.goto("/login");
    await page.getByLabel("Email Address or Store ID", { exact: true }).fill(storeLogin!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(new URL("/products", baseURL!).toString());
    await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
    for (const asin of asins) {
      const row = page.getByRole("row").filter({ hasText: asin });
      await expect(row).toHaveCount(1);
      await row.getByRole("checkbox").check();
    }
    const check = page.getByRole("button", { name: `Check ${asins.length} Selected`, exact: true });
    await expect(check).toBeEnabled();

    // Continue the actual request; block accidental whole-store submission rather than mocking a result.
    let submittedIds: string[] = [];
    await page.route("**/api/price-check/jobs", async route => {
      if (route.request().method() !== "POST") return route.continue();
      const payload = route.request().postDataJSON();
      if (payload.all || payload.allOnHold || !Array.isArray(payload.productIds) || payload.productIds.length !== asins.length || new Set(payload.productIds).size !== asins.length) {
        await route.abort();
        throw new Error("The browser attempted a check outside the selected test products.");
      }
      submittedIds = payload.productIds;
      await route.continue();
    });
    const childEnv = { ...process.env, LISTFLOW_E2E_BASE_URL: baseURL };
    delete childEnv.LISTFLOW_E2E_STORE_PASSWORD;
    const worker = fork(path.resolve("scripts/local-manual-check-test-worker.ts"), [], { execArgv: ["--import", "tsx"], env: childEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let workerLog = "";
    worker.stdout?.on("data", data => { workerLog += data.toString(); });
    worker.stderr?.on("data", data => { workerLog += data.toString(); });
    let jobId: string | undefined;
    let completed = false;
    let ready: WorkerMessage | undefined;
    let result: WorkerMessage | undefined;
    let elapsedMs: number | undefined;
    try {
      ready = await waitForMessage(worker, "ready", 60_000);
      const reuseOn = process.env.LISTFLOW_LOCAL_MANUAL_TEST_DELIVERY_STATE === "on";
      expect((ready.optimization as { deliveryStateEnabled: boolean }).deliveryStateEnabled).toBe(reuseOn);
      expect((ready.optimization as { enabled: string[] }).enabled).toEqual(reuseOn ? ["delivery-state"] : []);
      const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/price-check/jobs") && response.request().method() === "POST");
      const startedAt = Date.now();
      await check.click();
      const accepted = await responsePromise;
      const body = await accepted.json();
      expect(accepted.ok(), body.error || "The real job must be accepted.").toBeTruthy();
      expect(body.reused).toBe(false);
      expect(body.job.scope).toBe("SELECTED");
      expect(body.job.trigger).toBe("MANUAL");
      expect(body.job.total).toBe(asins.length);
      jobId = body.job.id;
      const resultPromise = waitForMessage(worker, "result", 300_000);
      worker.send({ jobId, productIds: submittedIds });
      result = await resultPromise;
      elapsedMs = Date.now() - startedAt;
      const response = await page.request.get(`/api/price-check/jobs/${jobId}`);
      expect(response.ok()).toBeTruthy();
      const final = (await response.json()).job;
      completed = ["COMPLETED", "FAILED", "CANCELLED"].includes(final.status);
      const report = { collectedAt: new Date().toISOString(), test: "actual-selected-manual-check", storeLogin, asins, jobId, elapsedMs, worker: ready, result, browserJob: final };
      mkdirSync("scratch/local-live", { recursive: true });
      const reportTag = process.env.LISTFLOW_LOCAL_MANUAL_TEST_REPORT_TAG || "manual-check-results";
      expect(reportTag).toMatch(/^[a-z0-9-]+$/);
      writeFileSync(`scratch/local-live/${reportTag}.json`, JSON.stringify(report, null, 2));
      await testInfo.attach("manual-check-results", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
      expect(final.status, final.waitReason || final.errorMessage || "The selected job should complete.").toBe("COMPLETED");
      expect(final.checked).toBe(asins.length);
      // Genuine product-specific failures remain visible and are compared, not disguised as success.
      expect(final.remaining).toBe(0);
      expect(result.completedProductIds).toEqual(expect.arrayContaining(submittedIds));
      const observations = result.observations as Array<{ postcodeVerified: boolean; verifiedPostcode: string; failureCode: string | null }>;
      expect(observations).toHaveLength(asins.length);
      for (const observation of observations) {
        expect(observation.postcodeVerified).toBe(true);
        expect(observation.verifiedPostcode).toBe("2217");
        expect(observation.failureCode).not.toBe("TECHNICAL_ERROR");
      }
      expect(result.recordedScrapes as unknown[]).toHaveLength(asins.length);
      expect(result.timing as unknown[]).toHaveLength(1);
      if (reuseOn) {
        const reuseSummary = (result.deliveryReuse as Array<{ events: Record<string, number>; disabled: boolean }>)[0];
        expect(reuseSummary, "The real run must record reuse diagnostics.").toBeTruthy();
        expect(reuseSummary.disabled).toBe(false);
        expect(reuseSummary.events.reused, "At least one subsequent page must reuse the verified state.").toBeGreaterThan(0);
      }
      await expect(page.getByText(new RegExp(`Checked ${asins.length} products\\.`)).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel("Search products", { exact: true })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath("manual-check-completed.png"), fullPage: false });
      console.log(`Actual selected manual check: ${asins.length} products, ${Math.round(elapsedMs / 1000)}s, ${final.failed} failed.`);
    } finally {
      if (jobId && !completed) await page.request.post(`/api/price-check/jobs/${jobId}/cancel`, { data: {} }).catch(() => {});
      if (worker.exitCode === null) {
        await Promise.race([new Promise<void>(resolve => worker.once("exit", () => resolve())), new Promise<void>(resolve => setTimeout(resolve, 15_000))]);
        if (worker.exitCode === null) worker.kill();
      }
      await testInfo.attach("local-worker-log", { body: workerLog, contentType: "text/plain" });
    }
  });
});

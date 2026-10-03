import { expect, test } from "playwright/test";
import { build } from "esbuild";

const bundle = build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import ActionCenterClient from "./components/ActionCenterClient";
  createRoot(document.getElementById("root")).render(<ActionCenterClient data={window.fixtureData} />);
` }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
  plugins: [{ name: "shell", setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "shell" }));
    builder.onLoad({ filter: /.*/, namespace: "shell" }, args => ({ resolveDir: process.cwd(), contents: args.path === "next/navigation"
      ? `export const useRouter = () => ({ refresh(){}, push(){} });`
      : `import React from "react"; export default props => React.createElement("a", props);` }));
  } }],
}).then(result => result.outputFiles[0].text);

for (const store of ["RK Ecommerce", "Aussie Walmart", "Oz Metro"]) {
  for (const width of [1280,390]) test(`${store}: concurrent checks and navigation remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const now = new Date().toISOString();
    const jobs = ["manual","automatic"].map((id,index) => ({ id, trigger: index ? "AUTOMATIC" : "MANUAL",
      status: "RUNNING", scope: index ? "ALL" : "SELECTED", schedulerVersion: 1,
      checked: 1, total: index ? 808 : 3, pendingReview: 0, failed: 0, autoHoldQueued: 0,
      createdAt: now, updatedAt: now, startedAt: now, completedAt: null, dismissedAt: null, errorMessage: null }));
    const workers = jobs.map((job,index) => ({ workerId: `worker-${index}`, workerName: `${store} Worker ${index ? "B" : "A"}`,
      workerRole: "store-specific", online: true, currentJobs: [{ jobType: "PRICE_CHECK", jobId: job.id,
        workerId: `worker-${index}`, workerName: `${store} Worker ${index ? "B" : "A"}`, renewedAt: now }] }));
    const data = { worker: workers[0], workers,
      summary: {pendingReviews:0,failedChecks:0,lowStock:0,onHold:0,runningJobs:2},
      queues: {pendingReviews:[],failedChecks:[],lowStock:[],onHold:[]},
      jobs: {priceChecks:jobs,ebayImports:[],ebayActions:[],ebayResearchBatches:[]} };
    await page.route("http://listflow.test/**", async route => {
      if (route.request().url().endsWith("/action-center")) {
        await route.fulfill({contentType:"text/html",body:'<html><body><div id="root"></div></body></html>'});
      } else await route.fulfill({json:{data:{...data,runningJobs:2}}});
    });
    await page.goto("http://listflow.test/action-center");
    await page.evaluate(value => { (window as unknown as {fixtureData:unknown}).fixtureData=value; },data);
    await page.addScriptTag({content:await bundle});
    await expect(page.getByText("Product price check",{exact:true})).toHaveCount(2);
    await expect(page.getByText("RUNNING",{exact:true})).toHaveCount(2);
    await expect(page.getByText(`Worker: ${store} Worker A`,{exact:true})).toBeVisible();
    await expect(page.getByText(`Worker: ${store} Worker B`,{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Start new job",exact:true}).click();
    await page.getByRole("button",{name:"Current / paused",exact:true}).click();
    await expect(page.getByRole("button",{name:"Pause",exact:true})).toHaveCount(2);
    await expect(page.locator('a[href="/products"]').first()).toBeVisible();
  });
}

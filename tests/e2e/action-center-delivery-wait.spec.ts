import { expect, test } from "playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
const styles = postcss([tailwindcss()]).process(fs.readFileSync("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") }).then(result => result.css);
test.use({ timezoneId: "Asia/Dhaka", locale: "en-AU" });
const bundle = build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
 import React from "react";import {createRoot} from "react-dom/client";import ActionCenterClient from "./components/ActionCenterClient";
 createRoot(document.getElementById("root")).render(<ActionCenterClient data={window.fixtureData}/>);
` }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic", plugins: [{ name: "shell", setup(builder) {
                builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "shell" }));
                builder.onLoad({ filter: /.*/, namespace: "shell" }, args => ({ resolveDir: process.cwd(), contents: args.path === "next/navigation" ? "const router={refresh(){},push(){}};export const useRouter=()=>router;" : "import React from 'react';export default props=>React.createElement('a',props);", loader: "tsx" }));
            } }] }).then(result => result.outputFiles[0].text);
for (const version of [1, 2])
    for (const width of [1280, 390])
        test(`version ${version} delivery cooldown transitions and controls at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 1000 });
            await page.emulateMedia({ reducedMotion: "reduce" });
            const errors: string[] = [];
            page.on("pageerror", error => errors.push(error.message));
            const now = new Date().toISOString();
            const retryAt = new Date(Date.now() + 60000).toISOString();
            let assigned = false;
            let cancellations = 0;
            let job = { id: "job", schedulerVersion: version, status: "QUEUED", scope: "ALL", trigger: "AUTOMATIC", total: 212, checked: 126, changed: 0, pendingReview: 0, failed: 24, skipped: 102, remaining: 86, canResume: false, autoHoldQueued: 0,
                createdAt: now, updatedAt: now, startedAt: now, completedAt: null, dismissedAt: null, reason: "Historical delivery failure", errorMessage: null,
                retryAt: retryAt as string | undefined, technicalFailureCode: "AMAZON_DELIVERY_POSTCODE_UNVERIFIED" as string | undefined, waitReason: "Amazon delivery setup unavailable." as string | undefined };
            const worker = () => ({ workerId: "worker-a", workerName: "Store Worker A", workerRole: "store-specific", online: true, currentJobs: assigned ? [{ jobType: "PRICE_CHECK", jobId: "job", workerId: "worker-a", workerName: "Store Worker A", renewedAt: now }] : [] });
            const live = () => ({ worker: worker(), workers: [worker()], runningJobs: ["RUNNING", "QUEUED"].includes(job.status) ? 1 : 0, jobs: { priceChecks: [{ ...job, assignedWorkerNames: assigned ? ["Store Worker A"] : [] }], ebayImports: [], ebayActions: [], ebayResearchBatches: [] } });
            const data = () => ({ ...live(), summary: { pendingReviews: 0, failedChecks: 0, lowStock: 0, onHold: 0, runningJobs: 1 }, queues: { pendingReviews: [], failedChecks: [], lowStock: [], onHold: [] } });
            await page.route("**/*", async (route) => {
                const url = new URL(route.request().url());
                if (url.origin !== "http://listflow.test") {
                    errors.push("Unexpected request: " + url.origin);
                    await route.abort();
                    return;
                }
                if (url.pathname === "/action-center") {
                    await route.fulfill({ contentType: "text/html", body: `<html><head><style>${await styles}</style></head><body><div id="root"></div></body></html>` });
                    return;
                }
                if (url.pathname === "/api/action-center/live") {
                    await route.fulfill({ json: live() });
                    return;
                }
                if (url.pathname === "/api/price-check/jobs/job/cancel") {
                    cancellations++;
                    job = { ...job, status: "CANCELLED", canResume: true, retryAt: undefined };
                    assigned = false;
                    await route.fulfill({ json: { job } });
                    return;
                }
                errors.push("Unexpected request: " + url.pathname);
                await route.abort();
            });
            await page.goto("http://listflow.test/action-center");
            await page.evaluate(value => { (window as unknown as {
                fixtureData: unknown;
            }).fixtureData = value; }, data());
            await page.addScriptTag({ content: await bundle });
            await expect(page.getByText("Waiting for Amazon delivery verification", { exact: true })).toBeVisible();
            const message = page.getByText(/Amazon delivery setup unavailable\. Retrying at/);
            await expect(message).toBeVisible();
            await expect(message).toContainText("GMT+6");
            await expect(message).toContainText("Completed 126 of 212; remaining products preserved");
            await expect(message).toHaveCSS("white-space", "normal");
            await expect(page.getByText("Waiting for worker", { exact: true })).toHaveCount(0);
            job = { ...job, status: "RUNNING" };
            assigned = true;
            await expect(page.getByText("Worker: Store Worker A", { exact: true })).toBeVisible();
            await expect(page.getByText("Retrying Amazon delivery verification.", { exact: true })).toBeVisible();
            job = { ...job, retryAt: undefined, technicalFailureCode: undefined, waitReason: undefined, checked: 127, failed: 25 };
            await expect(page.getByText("Retrying Amazon delivery verification.", { exact: true })).toHaveCount(0);
            await expect(page.getByText(/127\/212 checked/)).toBeVisible();
            job = { ...job, status: "QUEUED", retryAt: new Date(Date.now() - 60000).toISOString() };
            assigned = false;
            await expect(page.getByText(/Amazon delivery verification is due\./)).toBeVisible();
            await expect(page.getByText(/Retrying at/)).toHaveCount(0);
            job = { ...job, retryAt: "not-a-date" };
            await expect(page.getByText("Waiting for Amazon delivery verification", { exact: true })).toHaveCount(0);
            await page.getByRole("button", { name: "Pause", exact: true }).click();
            await expect.poll(() => cancellations).toBe(1);
            await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
            await expect(page.getByText(/Retrying at|delivery verification is due/)).toHaveCount(0);
            assertNoErrors();
            function assertNoErrors() { expect(errors).toEqual([]); }
        });
for (const width of [1280, 390])
    test(`older Jobs response and historical reasons at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        const now = new Date().toISOString();
        const worker = { workerId: "worker", workerName: "Store Worker", online: true, currentJobs: [] };
        const jobs = ["QUEUED", "CANCELLED", "COMPLETED"].map(status => ({ id: status, status, schedulerVersion: 1, scope: "ALL", checked: 126, total: 212, changed: 0, failed: 24, skipped: 102, pendingReview: 0, remaining: 86, canResume: status === "CANCELLED", autoHoldQueued: 0, reason: "Amazon delivery setup unavailable.", createdAt: now, updatedAt: now, startedAt: now, completedAt: status === "COMPLETED" ? now : null, dismissedAt: null }));
        const data = { worker, workers: [worker], summary: { pendingReviews: 0, failedChecks: 0, lowStock: 0, onHold: 0, runningJobs: 1 }, queues: { pendingReviews: [], failedChecks: [], lowStock: [], onHold: [] }, jobs: { priceChecks: jobs, ebayImports: [], ebayActions: [], ebayResearchBatches: [] } };
        await page.route("**/*", async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== "http://listflow.test") {
                errors.push("Unexpected request");
                await route.abort();
                return;
            }
            if (url.pathname === "/action-center")
                await route.fulfill({ contentType: "text/html", body: `<html><head><style>${await styles}</style></head><body><div id="root"></div></body></html>` });
            else if (url.pathname === "/api/action-center/live")
                await route.fulfill({ json: { ...data, runningJobs: 1 } });
            else {
                errors.push(url.pathname);
                await route.abort();
            }
        });
        await page.goto("http://listflow.test/action-center");
        await page.evaluate(value => { (window as unknown as {
            fixtureData: unknown;
        }).fixtureData = value; }, data);
        await page.addScriptTag({ content: await bundle });
        await expect(page.getByText("Waiting for worker", { exact: true })).toBeVisible();
        await expect(page.getByText("No active worker", { exact: true })).toBeVisible();
        await expect(page.getByText(/Waiting for Amazon delivery verification|Retrying at/)).toHaveCount(0);
        await page.getByRole("button", { name: "Recent", exact: true }).click();
        await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
        await expect(page.getByText(/Retrying at/)).toHaveCount(0);
        expect(errors).toEqual([]);
    });

for(const width of [1280,390])test("approved deferred prices persist in the actual Action Center at "+width,async({page})=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const data={worker:{online:false,currentJobs:[]},workers:[],summary:{pendingReviews:1,failedChecks:0,lowStock:0,onHold:0,runningJobs:0},queues:{pendingReviews:[{product:{id:"p",title:"Deferred variation",asin:"B07G5B97VD",ebayItemId:"304997589004"},priceHistoryId:"h",pendingCount:1,previousPrice:"150",newPrice:"160",previousSellPrice:"196.23",newSellPrice:"239.99",changeAmount:"10",profit:"20",createdAt:"2026-10-07T00:00:00Z",priceUpdateState:"AWAITING_RESTORATION"}],failedChecks:[],lowStock:[],onHold:[]},jobs:{priceChecks:[],ebayImports:[],ebayActions:[],ebayResearchBatches:[]}};
 await page.route("**/*",async route=>{const url=new URL(route.request().url());if(url.origin==="http://listflow.test"&&url.pathname==="/action-center"){await route.fulfill({contentType:"text/html",body:'<html><head><style>'+await styles+'</style></head><body><div id="root"></div></body></html>'});return;}errors.push("Unexpected request: "+url.pathname);await route.abort();});
 const open=async()=>{await page.goto("http://listflow.test/action-center");await page.evaluate(value=>{(window as unknown as {fixtureData:unknown}).fixtureData=value;},data);await page.addScriptTag({content:await bundle});};
 await open();await expect(page.getByRole("button",{name:"Price update waiting for stock restoration",exact:true}).filter({visible:true})).toBeDisabled();
 await open();await expect(page.getByRole("button",{name:"Price update waiting for stock restoration",exact:true}).filter({visible:true})).toBeDisabled();expect(errors).toEqual([]);
});

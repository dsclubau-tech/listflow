import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { getLiveActionCenterData } from "./action-center";
const compiled = build({ entryPoints: ["lib/action-center.ts"], bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
    plugins: [{ name: "offline-action-center", setup(builder) {
                const replacements: Record<string, string> = {
                    "server-only": "", "next/cache": "export const cacheLife=()=>{};export const cacheTag=()=>{};export const revalidateTag=()=>{};",
                    "prisma": "export const prisma=globalThis.database;",
                    "worker-heartbeat": "export const getWorkerStatusesForStore=async()=>[];export const getOfflineWorkerStatus=()=>({online:false});",
                    "price-check-item-scheduler": "export const getPriceCheckItemDiagnostics=async()=>({waitReason:'Item worker occupied',retryWaitingItems:1});",
                    "amazon-delivery-cooldown": "export const getAmazonDeliveryWait=()=>globalThis.deliveryWait();export const deliveryFailureCode=()=> 'AMAZON_DELIVERY_POSTCODE_UNVERIFIED';",
                };
                builder.onResolve({ filter: /^(server-only|next\/cache|@\/lib\/[\w-]+)$/ }, args => {
                    const key = args.path.replace(/^@\/lib\//, "");
                    return key in replacements ? { path: key, namespace: "fixture" } : undefined;
                });
                builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: replacements[args.path], loader: "ts", resolveDir: process.cwd() }));
            } }],
}).then(result => result.outputFiles[0].text);
async function fixture() {
    const now = new Date();
    let waitCalls = 0;
    let wait: {
        retryAt: string;
        waitReason: string;
    } | null = { retryAt: new Date(now.getTime() + 60000).toISOString(), waitReason: "Amazon delivery setup unavailable. Remaining products preserved." };
    const jobs = ["QUEUED", "RUNNING", "CANCELLED", "COMPLETED", "FAILED"].flatMap(status => [1, 2].map(version => ({
        id: `${status}-${version}`, status, schedulerVersion: version, scope: "ALL", trigger: "AUTOMATIC", checked: 126, total: 212, failed: 24, skipped: 102,
        reason: "Historical delivery failure", errorMessage: "[AMAZON_DELIVERY_POSTCODE_UNVERIFIED] Historical delivery failure",
        createdAt: now, updatedAt: now, startedAt: now, completedAt: null, dismissedAt: null, autoHoldQueued: 0,
    })));
    const empty = { findMany: async () => [] };
    const database = { priceCheckJob: { findMany: async () => jobs }, ebayImportJob: empty, ebayActionJob: empty, ebayResearchBatch: empty, $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries) };
    const result = { exports: {} };
    vm.runInNewContext(await compiled, { module: result, exports: result.exports, require: createRequire(import.meta.url), globalThis: { database, deliveryWait: async () => { waitCalls++; return wait; } }, Date, process, console });
    return { api: result.exports as {
            getLiveActionCenterData: typeof getLiveActionCenterData;
        }, waitCalls: () => waitCalls, setWait: (value: typeof wait) => { wait = value; } };
}
test("live Jobs reads delivery wait once and adds it only to active jobs for both schedulers", async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([f.api.getLiveActionCenterData("store"), f.api.getLiveActionCenterData("store")]);
    assert.deepEqual(first, second);
    assert.equal(f.waitCalls(), 1);
    for (const job of first.jobs.priceChecks) {
        if (["QUEUED", "RUNNING"].includes(job.status)) {
            assert.ok(job.retryAt);
            assert.equal(job.technicalFailureCode, "AMAZON_DELIVERY_POSTCODE_UNVERIFIED");
            assert.match(job.waitReason ?? "", /Amazon delivery/);
        }
        else {
            assert.equal(job.retryAt, undefined);
            assert.equal(job.technicalFailureCode, undefined);
            assert.doesNotMatch(job.waitReason ?? "", /Amazon delivery/);
        }
    }
});
test("cleared delivery evidence removes retry details and retains item scheduler diagnostics", async () => {
    const f = await fixture();
    await f.api.getLiveActionCenterData("store");
    f.setWait(null);
    const live = await f.api.getLiveActionCenterData("store");
    assert.equal(f.waitCalls(), 2);
    for (const job of live.jobs.priceChecks) {
        assert.equal(job.retryAt, undefined);
        assert.equal(job.technicalFailureCode, undefined);
        if (job.schedulerVersion === 2 && ["QUEUED", "RUNNING"].includes(job.status))
            assert.equal(job.waitReason, "Item worker occupied");
    }
});

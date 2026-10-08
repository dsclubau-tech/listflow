import assert from "node:assert/strict";
import test from "node:test";
import { loadMockedModule } from "../tests/helpers/mocked-module";

type RecordLine = Record<string, unknown> & { id: string; orderModifiedAt: Date; status: string; estimatedArrival: string | null };
async function fixture() {
  const state = { id: "state", activatedAt: new Date(Date.now() - 600_000), lastSyncedTo: null as Date | null, lastSuccessAt: null as Date | null, lastError: null as string | null, claimToken: null as string | null };
  const lines = new Map<string, RecordLine>();
  const writes: Record<string, unknown>[] = [];
  let fail = false, blocked = false, tokenRevoked = false, completions = 0, retries = 0;
  const product = { id: "product", storeId: "store", ebayItemId: "123", asin: "B012345678", amazonPrice: 10, images: [],
    promotedAdStatus: "NOT_PROMOTED", promotedAdPercent: 0, promotedAdRateStrategy: "FIXED",
    variants: [{ id: "variant", sku: "sku", buyPrice: 10, feesPercent: 10, feesFixed: 0.3, images: [] }] };
  const stateModel = {
    upsert: async () => ({ ...state }), update: async ({ data }: { data: object }) => Object.assign(state, data),
    findUniqueOrThrow: async () => ({ ...state }),
    updateMany: async ({ where, data }: { where: { claimToken: string }; data: object }) => {
      if (where.claimToken !== state.claimToken || tokenRevoked) return { count: 0 };
      Object.assign(state, data); return { count: 1 };
    },
  };
  const key = (values: Record<string, unknown>) => String(values.ebayOrderId) + "/" + String(values.lineItemId);
  const lineModel = {
    findUnique: async ({ where }: { where: { storeId_accountKey_ebayOrderId_lineItemId: Record<string, unknown> } }) => lines.get(key(where.storeId_accountKey_ebayOrderId_lineItemId)) ?? null,
    upsert: async ({ where, create, update }: { where: { storeId_accountKey_ebayOrderId_lineItemId: Record<string, unknown> }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      assert.equal(Object.hasOwn(update, "status"), false);
      assert.equal(Object.hasOwn(update, "estimatedArrival"), false);
      writes.push(update);
      const id = key(where.storeId_accountKey_ebayOrderId_lineItemId);
      const old = lines.get(id);
      const row = old ? { ...old, ...update } : { id, status: "PENDING", estimatedArrival: null, ...create };
      lines.set(id, row as RecordLine); return row;
    },
    findMany: async ({ cursor }: { cursor?: { id: string } }) => cursor ? [] : Array.from(lines.values()),
    updateMany: async ({ where, data }: { where: { id: string }; data: object }) => { Object.assign(lines.get(where.id)!, data); return { count: 1 }; },
  };
  const prisma: Record<string, unknown> = { ebayOrderSyncState: stateModel, ebayOrderLine: lineModel };
  prisma.$transaction = async (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma);
  const sync = await loadMockedModule<typeof import("./ebay-orders-sync")>("lib/ebay-orders-sync.ts", {
    "server-only": {},
    "@/lib/prisma": { prisma },
    "@/lib/logger": { logger: { info() {}, warn() {} } },
    "@/lib/ebay": { getStoreNumber: async () => 1, getStoreCredentials: () => ({ refreshToken: "configured", appId: "app", certId: "cert" }) },
    "@/lib/orders-data": { orderAccountKey: () => "account", loadOrderMatchProducts: async () => [product] },
    "@/lib/ebay-orders-client": {
      EbayOrdersRequestError: class extends Error {},
      fetchEbayOrdersPage: async () => {
        if (fail) throw new Error("temporary");
        return { orders: [
          { orderId: "order", creationDate: new Date(Date.now() - 120_000).toISOString(), lastModifiedDate: new Date().toISOString(),
            lineItems: [{ lineItemId: "line", legacyItemId: "123", sku: "sku", title: "Purchased", quantity: 2, lineItemCost: { value: "50.00", currency: "AUD" } }] },
          { orderId: "old", creationDate: new Date(Date.now() - 900_000).toISOString(), lineItems: [] },
        ], total: 2 };
      },
    },
    "@/lib/worker-schedule": {
      tryClaimWorkerSchedule: async () => blocked ? null : { id: "schedule", storeId: "store", workerId: "worker", taskKey: "ebay-orders-sync" },
      withWorkerScheduleClaim: async (_claim: unknown, _ttl: unknown, run: () => Promise<unknown>) => run(),
      completeWorkerSchedule: async (_claim: unknown, interval: number) => { assert.equal(interval, 300_000); completions++; },
      retryWorkerSchedule: async () => { retries++; },
    },
  });
  return { sync, state, lines, writes, setFail: (value: boolean) => { fail = value; }, setBlocked: () => { blocked = true; },
    revokeToken: () => { tokenRevoked = true; }, completions: () => completions, retries: () => retries };
}
const worker = { workerId: "worker", workerName: "Worker", workerRole: "legacy" as const };

test("scheduled sync deduplicates persisted lines and preserves manual status/date", async () => {
  const f = await fixture();
  const originalActivation = f.state.activatedAt;
  await f.sync.runScheduledEbayOrderSync("store", worker);
  assert.equal(f.lines.size, 1);
  const line = f.lines.values().next().value!;
  assert.equal(line.status, "PENDING");
  assert.equal(line.productId, "product");
  line.status = "ORDERED"; line.estimatedArrival = "2026-10-12";
  await f.sync.runScheduledEbayOrderSync("store", worker);
  assert.equal(f.lines.size, 1);
  assert.equal(f.lines.values().next().value!.status, "ORDERED");
  assert.equal(f.lines.values().next().value!.estimatedArrival, "2026-10-12");
  assert.equal(f.state.activatedAt, originalActivation);
  assert.equal(f.completions(), 2);
});

test("failed sync leaves successful watermark and retained orders intact", async () => {
  const f = await fixture();
  await f.sync.runScheduledEbayOrderSync("store", worker);
  const watermark = f.state.lastSyncedTo, successAt = f.state.lastSuccessAt;
  f.setFail(true);
  await f.sync.runScheduledEbayOrderSync("store", worker);
  assert.equal(f.state.lastSyncedTo, watermark);
  assert.equal(f.state.lastSuccessAt, successAt);
  assert.equal(f.lines.size, 1);
  assert.equal(f.retries(), 1);
  assert.ok(f.state.lastError);
});

test("another worker's schedule claim prevents fetching or advancing progress", async () => {
  const f = await fixture(); f.setBlocked();
  await f.sync.runScheduledEbayOrderSync("store", worker);
  assert.equal(f.lines.size, 0); assert.equal(f.state.lastSyncedTo, null); assert.equal(f.completions(), 0);
});

test("a recovered claim fences an old run out of writes and cursor commits", async () => {
  const f = await fixture(); f.revokeToken();
  await f.sync.runScheduledEbayOrderSync("store", worker);
  assert.equal(f.lines.size, 0); assert.equal(f.state.lastSyncedTo, null); assert.equal(f.completions(), 0);
});

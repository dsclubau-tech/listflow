import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";
import { Prisma } from "@/app/generated/prisma/client";
import type { createEbayActionJob } from "@/lib/ebay-action-jobs";
import type { applyBulkProductEdits, normalizeBulkEditProductIds, prepareBulkProductEditJob } from "@/lib/product-bulk-edit";
import type { buildReviseItemXML } from "@/lib/ebay-xml";

type FixtureProduct = {
  id: string; storeId: string; title: string; status: "IMPORTED" | "ON_HOLD" | "DRAFT";
  ebayItemId: string | null; _count: { variants: number }; itemSpecifics: Record<string, string>;
  description: string; variants: []; quantity: number;
};
type FixtureJob = {
  id: string; storeId: string; requestId: string; productIds: string[]; total: number;
  status: string; type: string; completedAt: Date | null;
  processed: number; succeeded: number; failed: number; errors: unknown[];
  createdAt: Date; updatedAt: Date; startedAt: null; dismissedAt: null;
};
type FixtureItem = { jobId: string; productId: string; payload: unknown };
const compiled = build({
  stdin: { resolveDir: process.cwd(), contents: `
    export { createEbayActionJob } from "./lib/ebay-action-jobs";
    export { applyBulkProductEdits, normalizeBulkEditProductIds, prepareBulkProductEditJob } from "./lib/product-bulk-edit";
    export { buildReviseItemXML } from "./lib/ebay-xml";
  ` },
  bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  plugins: [{ name: "database-fixture", setup(builder) {
    builder.onResolve({ filter: /^(server-only|@\/lib\/prisma|@\/app\/generated\/prisma\/client)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
      args.path === "server-only" ? "" : args.path.endsWith("/prisma")
        ? "export const prisma = globalThis.bulkDatabase;"
        : "export const Prisma = globalThis.fixturePrisma;"
    }));
  } }],
}).then(result => result.outputFiles[0].text);

async function fixture(count: number) {
  const products = new Map<string, FixtureProduct>(Array.from({ length: count }, (_, index) => {
    const id = `product-${index}`;
    return [id, { id, storeId: "store-a", title: `Product ${index}`, status: "IMPORTED", ebayItemId: `ebay-${index}`,
      _count: { variants: 1 }, itemSpecifics: { Brand: "Original", _Country: "AU", _PostalCode: "3175", _Location: "Dandenong North, VIC" },
      description: "Product description", variants: [], quantity: 1 }];
  }));
  let jobs = new Map<string, FixtureJob>();
  let items: FixtureItem[] = [];
  let lock = Promise.resolve();
  const state = { readSizes: [] as number[], writeSizes: [] as number[], transactionTimeout: 0, failBatch: 0, visibleWhilePreparing: 0 };
  const database = {
    product: {
      async findMany({ where }: { where: { id: { in: string[] }; storeId: string } }) {
        state.readSizes.push(where.id.in.length);
        return where.id.in.map(id => products.get(id)).filter(product => product?.storeId === where.storeId);
      },
    },
    ebayActionJob: {
      async findFirst({ where }: { where: { storeId: string; requestId: string } }) {
        return Array.from(jobs.values()).find(job => job.storeId === where.storeId && job.requestId === where.requestId) ?? null;
      },
      async create() { throw new Error("Bulk jobs must be created inside the transaction"); },
    },
    async $transaction<T>(operation: (transaction: unknown) => Promise<T>, options?: { timeout: number }): Promise<T> {
      const previous = lock;
      let release!: () => void;
      lock = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const stagedJobs = new Map(jobs);
      const stagedItems = [...items];
      const stagedProducts = new Map(products);
      let batch = 0;
      state.transactionTimeout = options?.timeout ?? 0;
      try {
        const result = await operation({
          ebayActionJob: { async create({ data }: { data: Pick<FixtureJob, "storeId" | "requestId" | "productIds" | "total" | "status" | "type" | "completedAt"> }) {
            if (Array.from(stagedJobs.values()).some(job => job.storeId === data.storeId && job.requestId === data.requestId)) {
              throw new Prisma.PrismaClientKnownRequestError("Duplicate request", { code: "P2002", clientVersion: "fixture" });
            }
            const job = { processed: 0, succeeded: 0, failed: 0, errors: [], createdAt: new Date(), updatedAt: new Date(),
              startedAt: null, dismissedAt: null, ...data, id: `job-${stagedJobs.size + 1}` };
            stagedJobs.set(job.id, job);
            return job;
          } },
          bulkEditJobItem: { async createMany({ data }: { data: FixtureItem[] }) {
            state.visibleWhilePreparing = Math.max(state.visibleWhilePreparing, jobs.size);
            state.writeSizes.push(data.length);
            if (++batch === state.failBatch) throw new Error("Checkpoint preparation failed");
            stagedItems.push(...data);
          } },
          product: { async update({ where, data }: { where: { id: string }; data: Partial<FixtureProduct> }) {
            const changed = { ...products.get(where.id)!, ...data };
            stagedProducts.set(where.id, changed);
            return changed;
          } },
        });
        jobs = stagedJobs;
        items = stagedItems;
        for (const [id, product] of stagedProducts) products.set(id, product);
        return result;
      } finally { release(); }
    },
  };
  const fixtureModule = { exports: {} };
  vm.runInNewContext(await compiled, { module: fixtureModule, exports: fixtureModule.exports, require: createRequire(import.meta.url),
    globalThis: { bulkDatabase: database, fixturePrisma: Prisma }, process, console, Buffer, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => { throw new Error("Unexpected network call during mocked verification"); },
  });
  const api = fixtureModule.exports as {
    createEbayActionJob: typeof createEbayActionJob;
    prepareBulkProductEditJob: typeof prepareBulkProductEditJob;
    normalizeBulkEditProductIds: typeof normalizeBulkEditProductIds;
    applyBulkProductEdits: typeof applyBulkProductEdits;
    buildReviseItemXML: typeof buildReviseItemXML;
  };
  return { api, products, state, jobs: () => jobs, items: () => items };
}
const location = { field: "location", value: { location: "Australia", postalCode: "2153", locationText: "Bella Vista, NSW" } };
async function queue(f: Awaited<ReturnType<typeof fixture>>, ids: string[], requestId = "bulk-request-1") {
  const prepared = await f.api.prepareBulkProductEditJob({ storeId: "store-a", productIds: ids, operations: [location] });
  const result = await f.api.createEbayActionJob({ userId: "user-a", storeId: "store-a", type: "BULK_EDIT_REVISE",
    productIds: prepared.productIds, requestId, metadata: { kind: "bulk-edit", durable: true, fields: ["location"] },
    itemPayload: { operations: prepared.operations },
  });
  return { prepared, result };
}

for (const count of [500, 501, 812, 1_000, 10_000]) {
  test(`${count} products create one complete job without truncation`, async () => {
    const f = await fixture(count);
    const ids = Array.from(f.products.keys());
    const { result } = await queue(f, [...ids, ids[0], ` ${ids[1]} `]);
    assert.equal(result.job.total, count);
    assert.equal(f.jobs().size, 1);
    assert.equal(f.items().length, count);
    assert.equal(new Set(f.items().map(item => item.productId)).size, count);
    assert.ok(f.state.readSizes.every(size => size <= 1_000));
    assert.ok(f.state.writeSizes.every(size => size <= 1_000));
    assert.equal(f.state.transactionTimeout, 30_000);
    assert.equal(f.state.visibleWhilePreparing, 0);
    const repeated = await queue(f, ids);
    assert.equal(repeated.result.job.id, result.job.id);
    assert.equal(f.items().length, count);
  });
}

test("ineligible products and another store are excluded without dropping eligible IDs", async () => {
  const f = await fixture(1_005);
  f.products.get("product-1")!.storeId = "store-b";
  f.products.get("product-2")!.status = "DRAFT";
  f.products.get("product-3")!.ebayItemId = null;
  const { prepared, result } = await queue(f, [...f.products.keys(), "missing-product"]);
  assert.equal(prepared.skipped.length, 4);
  assert.equal(result.job.total, 1_002);
  assert.equal(f.items().length, 1_002);
  assert.ok(!f.items().some(item => ["product-1", "product-2", "product-3", "missing-product"].includes(item.productId)));
});

test("checkpoint failure rolls back the whole job and request can be retried", async () => {
  const f = await fixture(2_500);
  f.state.failBatch = 2;
  await assert.rejects(queue(f, [...f.products.keys()]), /Checkpoint preparation failed/);
  assert.equal(f.jobs().size, 0);
  assert.equal(f.items().length, 0);
  f.state.failBatch = 0;
  await queue(f, [...f.products.keys()]);
  assert.equal(f.jobs().size, 1);
  assert.equal(f.items().length, 2_500);
});

test("concurrent requests with the same request ID reuse one atomically created job", async () => {
  const f = await fixture(812);
  const ids = [...f.products.keys()];
  const results = await Promise.all([queue(f, ids), queue(f, ids), queue(f, ids)]);
  assert.equal(new Set(results.map(result => result.result.job.id)).size, 1);
  assert.equal(f.jobs().size, 1);
  assert.equal(f.items().length, 812);
});

test("Bella Vista survives product updates and exact mocked eBay revision payloads", async () => {
  const f = await fixture(812);
  const { prepared } = await queue(f, [...f.products.keys()]);
  const sent: string[] = [];
  for (const id of prepared.productIds) {
    await f.api.applyBulkProductEdits({ storeId: "store-a", productIds: [id], operations: prepared.operations });
    const product = f.products.get(id)!;
    assert.equal(product.itemSpecifics._Location, "Bella Vista, NSW");
    assert.equal(product.itemSpecifics._PostalCode, "2153");
    assert.equal(product.itemSpecifics._Country, "AU");
    assert.equal(product.itemSpecifics.Brand, "Original");
    const xml = f.api.buildReviseItemXML(product as unknown as Parameters<typeof buildReviseItemXML>[0], undefined, {
      includeLocation: true, includeTitle: false, includeDescription: false, includeStartPrice: false,
      includeQuantity: false, includeDispatchTimeMax: false, includeSellerProfiles: false,
    });
    const mockedMarketplaceWrite = async (payload: string) => { sent.push(payload); return { success: true }; };
    await mockedMarketplaceWrite(xml);
  }
  assert.equal(sent.length, 812);
  assert.ok(sent.every(xml => xml.includes("<Location>Bella Vista, NSW</Location>") && xml.includes("<PostalCode>2153</PostalCode>")));
});
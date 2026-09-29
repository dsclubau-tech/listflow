import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

test("an existing busy-title draft never reaches the eBay write", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgresql://audit:audit@localhost:5432/audit";
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  let productReads = 0;
  loader._load = function (...args: unknown[]) {
    if (args[0] === "server-only") return {};
    if (args[0] === "@/lib/prisma") return {
      prisma: { product: { findFirst: async () => {
        productReads += 1;
        return {
          id: "bad-draft", storeId: "store-a", title: "Server Busy",
          fullTitle: "Server Busy", asin: "B0TEST1234", ebayItemId: null,
          status: "DRAFT", store: { id: "store-a" },
        };
      } } },
    };
    return originalLoad.apply(this, args);
  };
  try {
    const { uploadProductToEbay } = await import("@/lib/ebay-upload");
    const result = await uploadProductToEbay({ productId: "bad-draft", storeId: "store-a", userId: "user-a" });
    assert.equal(productReads, 1);
    assert.equal(result.status, 422);
    assert.match(String(result.body.error), /Regrab/);
  } finally {
    loader._load = originalLoad;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  }
});

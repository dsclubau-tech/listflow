import assert from "node:assert/strict";
import test from "node:test";
import { planInventory, executeInventory, parseInventoryResponse, type InventorySnapshot } from "./ebay-inventory";
import { resolveDeferredPricing, shippingSettingsContext } from "./ebay-deferred-pricing";

function input(quantity = 0, parent = "parent") {
  const snapshot: InventorySnapshot = { itemId: "304997589004", status: "Active", tracking: "ItemID", currency: "AUD", sku: parent, variation: true, entries: [{ sku: "B07G5B97VD", price: 196.23, quantity }] };
  return { storeId: "store", productId: "p", itemId: snapshot.itemId, currency: "AUD", snapshot, variants: [{ id: "v", sku: "B07G5B97VD" }], requests: [{ variantId: "v", price: 239.99 }] };
}

test("parent/variation collision blocks both zero and positive quantity plans", () => {
  for (const quantity of [0, 1]) assert.throws(() => planInventory(input(quantity, "B07G5B97VD")), /parent label needs repair/);
});

test("combined restoration never claims success when only price or quantity was applied", async () => {
  for (const field of ["price", "quantity"] as const) {
    const i = input(); const p = planInventory({ ...i, requests: [{ variantId: "v", price: 239.99, quantity: 1 }] });
    let remote = structuredClone(i.snapshot), writes = 0;
    const run = () => executeInventory(p, { read: async () => remote, write: async () => { writes++; remote = structuredClone(remote); remote.entries[0][field] = field === "price" ? 239.99 : 1; return { success: true }; }, save: async () => {}, assertCurrent: async () => {}, apply: async () => { assert.fail("Partial fields cannot authorize local restoration"); } });
    const result = await run(); assert.equal(result.success, false); assert.equal(result.outcomeUncertain, true); await run(); assert.equal(writes, 1);
  }
});

test("version-one deferred upgrade preserves existing uncertainty and checkpoints", async () => {
  const i = input(), p = planInventory(i); p.version = 1; p.targets[0].state = "UNCERTAIN";
  const result = await executeInventory(p, { read: async () => i.snapshot, write: async () => { assert.fail("No blind resend"); }, save: async () => {}, assertCurrent: async () => {}, apply: async () => {} });
  assert.equal(result.outcomeUncertain, true); assert.equal(p.version, 1);
  p.targets[0].state = "PENDING";
  await executeInventory(p, { read: async () => i.snapshot, write: async () => { assert.fail("Zero stock price must defer"); }, save: async () => {}, assertCurrent: async () => {}, apply: async () => {} });
  assert.equal(p.version, 2); assert.equal(p.context.upgradedFromVersion, 1); assert.equal(p.targets[0].state, "DEFERRED");
});

test("deferred authorization coverage rejects stale or conflicting contexts", () => {
  const i = input(), at = new Date("2026-10-07T00:00:00Z"), variant = { id: "v", sku: "B07G5B97VD", buyPrice: 150, sellPrice: 196.23, quantity: 0, feesPercent: 10, feesFixed: 0, profitPercent: 10, profitFixed: 0, roundCents: null };
  const product = { id: "p", storeId: "store", ebayItemId: i.itemId, asin: "B07G5B97VD", amazonPriceTrackingMode: "REGULAR", status: "ON_HOLD", holdGeneration: 9, lastPriceCheck: at, holdLastObservationId: "obs", variants: [variant], priceHistory: [{ id: "h", variantId: "v", newSellPrice: 239.99 }], listingOperations: [] as Array<{ requestKey: string; preparedPayload: unknown }> };
  const p = planInventory({ ...i, requests: [{ variantId: "v", price: 239.99, priceHistoryIds: ["h"] }], context: { authorization: { source: "PRICE_APPROVAL", historyIds: ["h"] }, asin: product.asin, trackingMode: "REGULAR", status: product.status, holdGeneration: 9, lastPriceCheck: at.toISOString(), holdLastObservationId: "obs", supplierContext: shippingSettingsContext(), variants: [variant] } });
  product.listingOperations.push({ requestKey: "approved", preparedPayload: JSON.parse(JSON.stringify(p)) });
  assert.equal(resolveDeferredPricing(product).error, undefined); assert.equal(resolveDeferredPricing(product).coveredHistoryIds.length, 1);
  const jsonb = structuredClone(product);
  const stored = jsonb.listingOperations[0].preparedPayload as typeof p;
  stored.context.supplierContext = { scrapePostcode: "2217", maxShippingDays: 25, minProductQuantity: 2 };
  assert.equal(resolveDeferredPricing(jsonb).error, undefined, "JSONB object ordering must not invalidate unchanged settings");
  for (const field of ["asin", "amazonPriceTrackingMode", "holdGeneration", "holdLastObservationId", "lastPriceCheck"] as const) {
    const bad = structuredClone(product); Object.assign(bad, { [field]: field === "lastPriceCheck" ? new Date(at.getTime() + 1) : "changed" }); assert.ok(resolveDeferredPricing(bad).error);
  }
  const changed = structuredClone(product); changed.variants[0].buyPrice = 151; assert.ok(resolveDeferredPricing(changed).error);
  const missing = structuredClone(product); missing.priceHistory = []; assert.ok(resolveDeferredPricing(missing).error);
  const duplicate = structuredClone(product); duplicate.listingOperations.push({ requestKey: "duplicate", preparedPayload: p }); assert.match(resolveDeferredPricing(duplicate).error!, /Conflicting/);
  assert.ok(resolveDeferredPricing(product, { maxShippingDays: 24, scrapePostcode: "2217" }).error);
});

test("zero stock price changes are durable deferred targets without writes or application", async () => {
  const i = input(), p = planInventory(i);
  let writes = 0, applies = 0;
  const run = () => executeInventory(p, { read: async () => i.snapshot, write: async () => { writes++; return { success: true }; }, save: async () => {}, assertCurrent: async () => {}, apply: async () => { applies++; } });
  const r = await run(); await run();
  assert.equal(p.version, 2);
  assert.equal(p.targets[0].state, "DEFERRED");
  assert.equal(r.success, false);
  assert.equal(writes, 0); assert.equal(applies, 0);
});

test("matching zero-stock price is a verified no-op", async () => {
  const i = input(); i.requests[0].price = 196.23;
  const p = planInventory(i); let writes = 0;
  const r = await executeInventory(p, { read: async () => i.snapshot, write: async () => { writes++; return { success: true }; }, save: async () => {}, assertCurrent: async () => {}, apply: async () => {} });
  assert.equal(r.success, true); assert.equal(writes, 0);
});

test("parent change blocks listing-level writes before inventory execution", async () => {
  const i = input(1), p = planInventory(i); let writes = 0;
  p.listingStep = { state: "PENDING", xml: "<ReviseItemRequest/>", patch: {} };
  await assert.rejects(executeInventory(p, { read: async () => ({ ...i.snapshot, sku: "changed" }), write: async () => { writes++; return { success: true }; }, listingWrite: async () => { writes++; return { success: true }; }, save: async () => {}, assertCurrent: async () => {}, apply: async () => {} }), /structure changed/);
  assert.equal(writes, 0);
});

test("fresh pre-write parent and listing status changes block the complete request",async()=>{
 for(const change of ["collision","ended"] as const){
  const i=input(1),p=planInventory(i);let reads=0,writes=0;
  const changed={...i.snapshot,...(change==="collision"?{sku:"B07G5B97VD"}:{status:"Completed"})};
  await assert.rejects(executeInventory(p,{read:async()=>++reads===1?i.snapshot:changed,write:async()=>{writes++;return {success:true};},save:async()=>{},assertCurrent:async()=>{},apply:async()=>{}}),change==="collision"?/parent label needs repair/:/listing has ended/);
  assert.equal(writes,0);
 }
});

test("short and long eBay errors survive parsing and distinguish item-level from missing SKU", () => {
  for (const [code, short] of [["21916735", "Cannot revise a Multi-SKU item when item level SKU is supplied."], ["21916736", "Cannot revise a Multi-SKU item when ItemID alone is supplied."]]) {
    const r = parseInventoryResponse(`<ReviseInventoryStatusResponse><Ack>Failure</Ack><Errors><ErrorCode>${code}</ErrorCode><ShortMessage>${short}</ShortMessage><LongMessage>Variation level SKU required</LongMessage><SeverityCode>Error</SeverityCode></Errors></ReviseInventoryStatusResponse>`);
    assert.equal((r.errors?.[0] as unknown as { shortMessage: string }).shortMessage, short);
    assert.equal((r.errors?.[0] as unknown as { longMessage: string }).longMessage, "Variation level SKU required");
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { DELONGHI_REPAIR, parentSkuRepairXml, runParentSkuRepair, type ParentSkuRepairCheckpoint } from "./ebay-parent-sku-repair";
import type { InventorySnapshot } from "./ebay-inventory";

function fixture() {
  const remote: InventorySnapshot = { itemId: DELONGHI_REPAIR.itemId, status: "Active", tracking: "ItemID", currency: "AUD", sku: DELONGHI_REPAIR.sku, variation: true, entries: [{ sku: DELONGHI_REPAIR.sku, quantity: 0, price: 196.23 }], listing: { InventoryTrackingMethod: "ItemID", Variations: { Variation: { VariationSpecifics: { NameValueList: [{ Name: "Colour", Value: "White" }] } } } } };
  let saved: ParentSkuRepairCheckpoint | null = null, writes = 0, locks = 0;
  const io = { read: async () => structuredClone(remote), load: async () => saved, save: async (p: ParentSkuRepairCheckpoint) => { saved = structuredClone(p); }, acquire: async () => { locks++; return { assertOwnership: async () => {}, release: async () => { locks--; } }; }, assertNoUnresolved: async () => {}, write: async (xml: string) => { writes++; assert.equal(xml, parentSkuRepairXml()); remote.sku = undefined; return { success: true }; } };
  return { io, change: (fn: (s: InventorySnapshot) => void) => fn(remote), counts: () => ({ writes, locks }), checkpoint: () => saved };
}
test("restricted parent repair dry run never locks, persists or writes", async () => {
  const f = fixture(), result = await runParentSkuRepair({ storeId: DELONGHI_REPAIR.storeId }, f.io);
  assert.equal(result.dryRun, true); assert.equal(f.checkpoint(), null); assert.deepEqual(f.counts(), { writes: 0, locks: 0 });
  assert.match(result.xml!, /<DeletedField>Item.SKU<\/DeletedField>/); assert.doesNotMatch(result.xml!, /<SKU>|<Variations>|<StartPrice>|<Quantity>/);
});
test("repair requires separate authorization and validates all identity preconditions", async () => {
  const f = fixture(); await assert.rejects(runParentSkuRepair({ storeId: DELONGHI_REPAIR.storeId, apply: true }, f.io), /authorization/);
  for (const field of ["sku", "tracking", "itemId", "currency", "status"] as const) {
    const bad = fixture(); bad.change(s => { s[field] = "changed"; }); await assert.rejects(runParentSkuRepair({ storeId: DELONGHI_REPAIR.storeId }, bad.io), /preconditions/); assert.equal(bad.counts().writes, 0);
  }
  const quantity = fixture(); quantity.change(s => { s.entries[0].quantity = 1; }); await assert.rejects(runParentSkuRepair({ storeId: DELONGHI_REPAIR.storeId }, quantity.io), /preconditions/);
  await assert.rejects(runParentSkuRepair({ storeId: "other" }, f.io), /Wrong store/);
});
test("parent repair readback confirms only identity and repeated execution never resends", async () => {
  const f = fixture(), input = { storeId: DELONGHI_REPAIR.storeId, apply: true, authorized: true };
  assert.equal((await runParentSkuRepair(input, f.io)).confirmed, true); assert.equal(f.checkpoint()?.state, "CONFIRMED");
  const persisted = f.checkpoint()!; persisted.before = Object.fromEntries(Object.entries(persisted.before).reverse()) as typeof persisted.before;
  assert.equal((await runParentSkuRepair(input, f.io)).reconciled, true); assert.deepEqual(f.counts(), { writes: 1, locks: 0 });
});
test("uncertain parent repair reconciles without repeating even if the parent is still present", async () => {
  const f = fixture(), input = { storeId: DELONGHI_REPAIR.storeId, apply: true, authorized: true };
  let writes = 0; f.io.write = async () => { writes++; throw new Error("timeout"); };
  await assert.rejects(runParentSkuRepair(input, f.io), /unverified/);
  await assert.rejects(runParentSkuRepair(input, f.io), /No automatic resend/); assert.equal(writes, 1);
  f.change(s => { s.sku = undefined; }); assert.equal((await runParentSkuRepair(input, f.io)).confirmed, true); assert.equal(writes, 1);
});
test("successful acknowledgement cannot conceal changed variation price, quantity or specifics", async () => {
  for (const field of ["price", "quantity", "specifics"] as const) {
    const f = fixture(); f.io.write = async () => { f.change(s => { s.sku = undefined; if (field === "specifics") s.listing = { Variations: { Variation: { VariationSpecifics: "changed" } } }; else s.entries[0][field]++; }); return { success: true }; };
    await assert.rejects(runParentSkuRepair({ storeId: DELONGHI_REPAIR.storeId, apply: true, authorized: true }, f.io), /unverified/); assert.equal(f.checkpoint()?.state, "UNCERTAIN");
  }
});

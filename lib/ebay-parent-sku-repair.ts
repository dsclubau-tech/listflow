import type { InventoryResponse, InventorySnapshot } from "./ebay-inventory";
import { canonicalInventoryJson } from "./ebay-deferred-pricing";

export const DELONGHI_REPAIR = Object.freeze({ storeId: "seed-store-1", productId: "cmuo5d08u03sk5gvjwn9ldb7x", itemId: "304997589004", sku: "B07G5B97VD", tracking: "ItemID" });
export type ParentSkuRepairCheckpoint = { kind: "parent-sku-repair"; version: 2; state: "PREPARED" | "UNCERTAIN" | "CONFIRMED"; before: ReturnType<typeof repairEvidence>; xml: string };
export function parentSkuRepairXml() {
  return `<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DeletedField>Item.SKU</DeletedField><Item><ItemID>${DELONGHI_REPAIR.itemId}</ItemID></Item></ReviseItemRequest>`;
}
export function repairEvidence(snapshot: InventorySnapshot) {
  // Deliberately omit seller/address/account data and unrelated listing content.
  const variations = snapshot.listing?.Variations as { Variation?: unknown } | undefined;
  return { itemId: snapshot.itemId, status: snapshot.status, tracking: snapshot.tracking, reportedTracking: snapshot.listing?.InventoryTrackingMethod ?? null, currency: snapshot.currency, sku: snapshot.sku ?? null, variation: snapshot.variation,
    entries: snapshot.entries, variationSpecifics: variations?.Variation ? [variations.Variation].flat().map(v => (v as { VariationSpecifics?: unknown }).VariationSpecifics ?? null) : null };
}
function validateBefore(snapshot: InventorySnapshot, storeId: string) {
  if (storeId !== DELONGHI_REPAIR.storeId || snapshot.itemId !== DELONGHI_REPAIR.itemId || snapshot.tracking !== DELONGHI_REPAIR.tracking || snapshot.listing?.InventoryTrackingMethod !== "ItemID" || snapshot.status !== "Active" || snapshot.currency !== "AUD" || !snapshot.variation || snapshot.sku !== DELONGHI_REPAIR.sku || snapshot.entries.length !== 1 || snapshot.entries[0].sku !== DELONGHI_REPAIR.sku || snapshot.entries[0].quantity !== 0)
    throw new Error("De’Longhi repair preconditions changed. Stop for review.");
}
export async function runParentSkuRepair(input: { storeId: string; apply?: boolean; authorized?: boolean }, io: {
  read: () => Promise<InventorySnapshot>; load: () => Promise<ParentSkuRepairCheckpoint | null>;
  save: (checkpoint: ParentSkuRepairCheckpoint) => Promise<void>;
  acquire: () => Promise<{ assertOwnership: () => Promise<void>; release: () => Promise<void> }>;
  assertNoUnresolved: () => Promise<void>; write: (xml: string) => Promise<InventoryResponse>;
}) {
  if (input.storeId !== DELONGHI_REPAIR.storeId) throw new Error("Wrong store for the restricted repair.");
  if (input.apply && !input.authorized) throw new Error("Separate explicit authorization is required for the parent-label repair.");
  const checkpoint = await io.load();
  const current = await io.read();
  if (!input.apply) {
    if (!checkpoint) validateBefore(current, input.storeId);
    return { dryRun: true, before: repairEvidence(current), checkpoint, xml: parentSkuRepairXml(), confirmed: false };
  }
  const lease = await io.acquire();
  try {
    await lease.assertOwnership(); await io.assertNoUnresolved();
    const fresh = await io.read();
    const original = checkpoint?.before ?? repairEvidence(fresh);
    if (!checkpoint) validateBefore(fresh, input.storeId);
    const matchesAfter = (value: InventorySnapshot) => !value.sku && canonicalInventoryJson({ ...repairEvidence(value), sku: original.sku }) === canonicalInventoryJson(original);
    if (checkpoint) {
      if (checkpoint.kind !== "parent-sku-repair" || checkpoint.version !== 2 || checkpoint.xml !== parentSkuRepairXml()) throw new Error("Unsupported parent repair checkpoint.");
      if (matchesAfter(fresh)) { checkpoint.state = "CONFIRMED"; await io.save(checkpoint); return { dryRun: false, confirmed: true, reconciled: true }; }
      // Even PREPARED might have crossed the network before a process crash.
      throw new Error("Repair result needs verification. No automatic resend.");
    }
    const prepared: ParentSkuRepairCheckpoint = { kind: "parent-sku-repair", version: 2, state: "PREPARED", before: original, xml: parentSkuRepairXml() };
    await io.save(prepared); await lease.assertOwnership();
    await io.assertNoUnresolved();
    if (canonicalInventoryJson(repairEvidence(await io.read())) !== canonicalInventoryJson(original)) throw new Error("Listing changed during repair preparation. Stop for review.");
    // Record uncertainty before sending; acknowledgement never proves identity repair.
    prepared.state = "UNCERTAIN"; await io.save(prepared);
    try { await io.write(prepared.xml); } catch { /* Reconcile through readback. */ }
    await lease.assertOwnership();
    const after = await io.read();
    if (!matchesAfter(after)) throw new Error("Parent-label repair remains unverified. No automatic resend.");
    prepared.state = "CONFIRMED"; await io.save(prepared);
    return { dryRun: false, confirmed: true, reconciled: false };
  } finally { await lease.release(); }
}

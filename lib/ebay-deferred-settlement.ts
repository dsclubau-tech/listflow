import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { inventorySummary, type InventoryAuthorization, type InventoryPlan } from "./ebay-inventory";
import { canonicalInventoryJson, type DeferredPriceSource } from "./ebay-deferred-pricing";

// Settlement is local accounting after confirmed combined writes; it never calls eBay.
export async function settleDeferredInventory(requestKey: string, restoration: InventoryPlan, assertCurrent?: () => Promise<void>) {
  const sources = (restoration.context.deferredSources ?? []) as DeferredPriceSource[];
  if (!sources.length) return;
  if (!restoration.targets.every(t => t.state === "CONFIRMED" && t.applied)) throw new Error("Restoration still needs marketplace verification.");
  await assertCurrent?.();
  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Product" WHERE id = ${restoration.productId} FOR UPDATE`);
    for (const sourceKey of new Set(sources.map(s => s.requestKey))) {
      const row = await tx.listingOperation.findUnique({ where: { requestKey: sourceKey } });
      const source = row?.preparedPayload as unknown as InventoryPlan;
      if (!source || source.kind !== "ebay-inventory" || source.version !== 2 || source.itemId !== restoration.itemId || source.storeId !== restoration.storeId || source.productId !== restoration.productId) throw new Error("Deferred price source changed before confirmation.");
      const original = (restoration.context.deferredSourcePayloads as Array<{ requestKey: string; payload: unknown }>).find(p => p.requestKey === sourceKey);
      const alreadySettled = sources.filter(s => s.requestKey === sourceKey).every(s => source.targets.some(t => t.target.variantId === s.variantId && t.resolvedBy === requestKey));
      if (!alreadySettled && canonicalInventoryJson(source) !== canonicalInventoryJson(original?.payload)) throw new Error("Deferred source authorization changed during restoration.");
      for (const link of sources.filter(s => s.requestKey === sourceKey)) {
        const target = source.targets.find(t => t.target.variantId === link.variantId && t.target.sku === link.sku);
        const applied = restoration.targets.find(t => t.target.variantId === link.variantId && t.target.sku === link.sku && t.desired.price === link.price && t.desired.quantity === 1 && t.state === "CONFIRMED" && t.applied);
        if (!target || target.supersededBy || target.desired.price !== link.price || !applied || (target.resolvedBy && target.resolvedBy !== requestKey) || !["DEFERRED", "CONFIRMED"].includes(target.state)) throw new Error("Deferred price no longer matches the confirmed restoration.");
        if (JSON.stringify(target.desired.priceHistoryIds ?? []) !== JSON.stringify(link.historyIds)) throw new Error("Deferred price approval changed before confirmation.");
        if (link.historyIds.length) {
          const histories = await tx.priceHistory.findMany({ where: { id: { in: link.historyIds }, productId: restoration.productId, variantId: link.variantId } });
          if (histories.length !== link.historyIds.length || histories.some(h => Number(h.newSellPrice) !== link.price || (h.appliedAt !== null && !(target.resolvedBy === requestKey && h.status === "APPLIED" && h.ebayRevised)))) throw new Error("Deferred price approval was changed or withdrawn before confirmation.");
          if (applied.desired.localPatch?.buyPrice !== undefined && histories.some(h => Number(h.newPrice) !== Number(applied.desired.localPatch?.buyPrice))) throw new Error("Approved Amazon cost changed during restoration.");
        }
        target.state = "CONFIRMED"; target.applied = true; target.resolvedBy = requestKey; target.error = undefined;
        if (link.historyIds.length) await tx.priceHistory.updateMany({ where: { id: { in: link.historyIds }, productId: restoration.productId, variantId: link.variantId, newSellPrice: link.price, appliedAt: null }, data: { status: "APPLIED", appliedAt: new Date(), ebayRevised: true, errorMessage: null } });
      }
      const complete = inventorySummary(source).success && source.targets.every(t => t.applied) && (!source.listingStep || source.listingStep.applied);
      await tx.listingOperation.update({ where: { requestKey: sourceKey }, data: { preparedPayload: JSON.parse(JSON.stringify(source)), ...(complete ? { stage: "COMPLETED", lastError: null, completedAt: new Date(), ebayConfirmedAt: new Date() } : {}) } });
      const jobId = (source.context.authorization as InventoryAuthorization | undefined)?.sourceJobId;
      if (complete && jobId) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "EbayActionJob" WHERE id = ${jobId} FOR UPDATE`);
        const item = await tx.bulkEditJobItem.updateMany({ where: { jobId, productId: source.productId, status: "FAILED" }, data: { status: "SUCCEEDED", error: null, completedAt: new Date(), appliedAt: new Date() } });
        const job = await tx.ebayActionJob.findUnique({ where: { id: jobId } });
        if (item.count && job?.completedProductIds.includes(source.productId)) {
          const errors = Array.isArray(job.errors) ? job.errors.filter(e => !e || typeof e !== "object" || (e as Record<string, unknown>).productId !== source.productId) : [];
          await tx.ebayActionJob.update({ where: { id: jobId }, data: { succeeded: { increment: 1 }, failed: { decrement: 1 }, errors: errors as Prisma.InputJsonValue } });
        }
      }
    }
  });
}

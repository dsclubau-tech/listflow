import "server-only";
import { prisma } from "@/lib/prisma";
import { applyBulkProductEdits, type BulkEditProductSnapshot } from "./product-bulk-edit";
import { readEbayInventory, writeEbayInventory } from "./ebay-inventory-writer";
import { getStoreNumber } from "@/lib/ebay";
import { buildReviseItemXML } from "./ebay-xml";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import type { InventoryPlan, InventoryRequest } from "./ebay-inventory";
const pricing = new Set(["feesPercent", "feesFixed", "profitFixed", "profitPercent", "roundCents"]);
export async function executeBulkInventoryEdit(input: {
    jobId: string;
    productId: string;
    storeId: string;
    fields: Set<string>;
    operations?: unknown;
    assertCurrent?: () => Promise<void>;
}) {
    const product = await prisma.product.findFirst({ where: { id: input.productId, storeId: input.storeId }, include: { store: true, variants: { orderBy: { createdAt: "asc" } } } });
    if (!product?.ebayItemId || !["IMPORTED", "ON_HOLD"].includes(product.status))
        throw new Error("Product has no active eBay listing reference.");
    const requestKey = "inventory:bulk:" + input.jobId + ":" + product.id;
    const old = await prisma.listingOperation.findUnique({ where: { requestKey } });
    const item = await prisma.bulkEditJobItem.findUnique({ where: { jobId_productId: { jobId: input.jobId, productId: product.id } } });
    const payload = item?.payload as Record<string, unknown> | undefined;
    if(payload?.inventoryVersion!==undefined&&payload.inventoryVersion!==1)throw new Error("Unsupported bulk inventory payload version.");
    // Legacy APPLYING payloads may have been written. Do not undo accepted values or blindly replay them.
    const legacySnapshot = !old && payload?.snapshot ? payload.snapshot as BulkEditProductSnapshot : undefined;
    if (legacySnapshot && legacySnapshot.product.id !== product.id)
        throw new Error("Legacy product identity cannot be verified.");
    const versioned = payload?.inventoryV1 as Record<string, unknown> | undefined;
    const operations = input.operations ?? versioned?.operations ?? payload?.operations;
    if(item&&!Array.isArray(operations))throw new Error("Unsupported prepared bulk inventory payload.");
    const preview = operations ? await applyBulkProductEdits({ storeId: input.storeId, productIds: [product.id], operations, prepareOnly: true, preparationSnapshot: legacySnapshot }) : null;
    if (preview?.skipped.length)
        throw new Error(preview.skipped[0].reason);
    const proposal = preview?.preparedUpdates[0];
    const priceChanged = input.fields.size === 0 || [...input.fields].some(f => pricing.has(f));
    const quantityChanged = input.fields.has("quantity");
    const proposed = proposal?.productData ?? {};
    const requests: InventoryRequest[] = (priceChanged || quantityChanged) ? (product.variants.length ? product.variants.map(v => {
        const patch = proposal?.variantData.find(p => p.id === v.id)?.data;
        return { variantId: v.id, ...(priceChanged ? { price: Number(patch?.sellPrice ?? v.sellPrice) } : {}),
            ...(quantityChanged ? { quantity: Number(patch?.quantity ?? product.quantity) } : {}),
            localPatch: JSON.parse(JSON.stringify({ ...patch, ...(!priceChanged ? { sellPrice: undefined } : {}) })) };
    }) : [{ ...(priceChanged ? { price: Number(product.price) } : {}), ...(quantityChanged ? { quantity: Number(proposed.quantity ?? product.quantity) } : {}) }]) : [];
    let listingStep: InventoryPlan["listingStep"];
    const listingFields = [...input.fields].filter(f => !pricing.has(f) && f !== "quantity");
    if (listingFields.length) {
        const patch = { ...proposed };
        delete patch.quantity;
        delete patch.price;
        delete patch.status;
        delete patch.holdReason;
        const next = { ...product, ...patch } as typeof product;
        const description = await resolveDescriptionTemplate(next);
        listingStep = { state: "PENDING", patch: JSON.parse(JSON.stringify(patch)), xml: buildReviseItemXML({ ...next, description }, undefined, {
                includeStartPrice: false, includeQuantity: false, includeTitle: input.fields.has("title"),
                includeDescription: input.fields.has("title") || input.fields.has("templateId"),
                includeItemSpecifics: input.fields.has("brand"), includeLocation: input.fields.has("location"),
                includeDispatchTimeMax: input.fields.has("dispatchTimeMax"),
                includeSellerProfiles: listingFields.some(f => f.endsWith("PolicyId") || f === "policyTemplateId")
            }) };
    }
    await input.assertCurrent?.();
    const snapshot = old ? undefined : await readEbayInventory(product.ebayItemId, await getStoreNumber(input.storeId));
    if (item)
        await prisma.bulkEditJobItem.update({ where: { id: item.id }, data: { status: "APPLYING", attempts: { increment: 1 }, payload: JSON.parse(JSON.stringify({ inventoryV1: { operations }, inventoryVersion: 1, inventoryRequestKey: requestKey })) } });
    const savedPlan = old?.preparedPayload as unknown as InventoryPlan | undefined;
    const savedIntent = savedPlan?.context.intent ? JSON.parse(String(savedPlan.context.intent)) as {
        requests: InventoryRequest[];
    } : null;
    const result = await writeEbayInventory({ productId: product.id, storeId: input.storeId, requestKey, requests: savedIntent?.requests ?? requests, snapshot, listingStep,
        retryRejected: true, reconcileOnly: !!legacySnapshot, assertCurrent: input.assertCurrent });
    if (result.success && quantityChanged) {
        const quantity = Number(result.variationResults[0]?.desired.quantity ?? product.quantity);
        await prisma.product.update({ where: { id: product.id }, data: { quantity, status: quantity === 0 ? "ON_HOLD" : "IMPORTED",
                holdReason: quantity === 0 ? "Listing quantity was set to 0." : null } });
    }
    if (item)
        await prisma.bulkEditJobItem.update({ where: { id: item.id }, data: { status: result.success ? "SUCCEEDED" : "FAILED",
                error: result.errorMessage ?? null, completedAt: new Date() } });
    return result;
}

import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { callEbayGetItem, callEbayReviseInventoryStatus, callEbayReviseItem, getStoreNumber } from "@/lib/ebay";
import { buildGetItemXML } from "./ebay-xml";
import { executeInventory, inventorySummary, parseInventorySnapshot, planInventory, type InventoryPlan, type InventoryRequest, type InventoryResult, type InventorySnapshot } from "./ebay-inventory";
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function readEbayInventory(itemId: string, storeNumber: 1 | 2 | 3) {
    return parseInventorySnapshot(await callEbayGetItem(buildGetItemXML(itemId), storeNumber), itemId);
}
export type InventoryWriteInput = {
    productId: string;
    storeId: string;
    requestKey: string;
    requests: InventoryRequest[];
    allRemote?: boolean;
    automaticRecovery?: boolean;
    retryRejected?: boolean;
    assertCurrent?: () => Promise<void>;
    snapshot?: InventorySnapshot;
    listingStep?: InventoryPlan["listingStep"];
    context?: Record<string, unknown>;
    reconcileOnly?: boolean;
};
export async function writeEbayInventory(input: InventoryWriteInput) {
    const product = await prisma.product.findFirst({ where: { id: input.productId, storeId: input.storeId }, include: { variants: { orderBy: { createdAt: "asc" } } } });
    if (!product?.ebayItemId)
        throw new Error("Product has no active eBay listing reference.");
    const intent = JSON.stringify(json({ requests: input.requests, allRemote: input.allRemote ?? false, automaticRecovery: input.automaticRecovery ?? false }));
    const storeNumber = await getStoreNumber(input.storeId);
    const existing = await prisma.listingOperation.findUnique({ where: { requestKey: input.requestKey } });
    const unresolved = await prisma.listingOperation.findFirst({ where: { productId: input.productId, storeId: input.storeId, requestKey: { not: input.requestKey }, stage: { in: ["PREPARED", "PRICE_SYNC", "QUANTITY_SYNC", "RECONCILIATION"] }, preparedPayload:{path:["kind"],equals:"ebay-inventory"} } });
    if (unresolved && (unresolved.preparedPayload as Record<string, unknown>)?.kind === "ebay-inventory")
        throw new Error("A previous inventory update needs verification before another update.");
    let plan: InventoryPlan;
    let snapshot = input.snapshot;
    if (existing) {
        const saved = existing.preparedPayload as unknown as InventoryPlan;
        if (saved?.kind !== "ebay-inventory" || saved.version !== 1)
            throw new Error("Legacy inventory update needs reconciliation before retry.");
        plan = saved;
        if (plan.context.intent !== intent) {
            const previous = JSON.parse(String(plan.context.intent)) as {
                requests: InventoryRequest[];
                allRemote: boolean;
                automaticRecovery: boolean;
            };
            const requested = JSON.parse(intent) as typeof previous;
            const same = (a: InventoryRequest, b: InventoryRequest) => a.variantId === b.variantId && a.price === b.price && a.quantity === b.quantity && JSON.stringify(a.localPatch) === JSON.stringify(b.localPatch);
            const remainingOnly = requested.allRemote === previous.allRemote && requested.automaticRecovery === previous.automaticRecovery && requested.requests.every(r => previous.requests.some(p => same(r, p))) && previous.requests.filter(p => !requested.requests.some(r => same(r, p))).every(p => plan.targets.some(t => t.target.variantId === p.variantId && t.state === "CONFIRMED" && t.applied));
            if (!remainingOnly)
                throw new Error("Requested inventory values changed; resolve the previous operation before preparing a new request.");
        }
        if (plan.storeId!==input.storeId||plan.productId!==product.id||plan.itemId !== product.ebayItemId)
            throw new Error("eBay listing identity changed.");
    }
    else {
        await input.assertCurrent?.();
        snapshot ??= await readEbayInventory(product.ebayItemId, storeNumber);
        const specifics = product.itemSpecifics as Record<string, unknown> | null;
        plan = planInventory({ storeId: input.storeId, productId: product.id, itemId: product.ebayItemId, currency: String(specifics?._Currency ?? "AUD"),
            variants: product.variants, requests: input.requests, snapshot, allRemote: input.allRemote, automaticRecovery: input.automaticRecovery,
            context: { intent, productPrice:Number(product.price),lastPriceCheck:product.lastPriceCheck?.toISOString()??null,holdLastObservationId:product.holdLastObservationId??null,productQuantity: product.quantity, listingValues: { title: product.title, description: product.description, itemSpecifics: product.itemSpecifics, images: product.images, shippingPolicyId: product.shippingPolicyId, returnPolicyId: product.returnPolicyId, paymentPolicyId: product.paymentPolicyId, policyTemplateId: product.policyTemplateId, templateId: product.templateId }, holdGeneration: product.holdGeneration, status: product.status, asin: product.asin, trackingMode: product.amazonPriceTrackingMode,
                variants: product.variants.map(v => ({ id: v.id, sku: v.sku, sellPrice: Number(v.sellPrice), quantity: v.quantity, buyPrice: Number(v.buyPrice),
                    feesPercent: v.feesPercent, feesFixed: v.feesFixed, profitPercent: v.profitPercent, profitFixed: v.profitFixed, roundCents: v.roundCents })), ...input.context } });
        if (input.listingStep)
            plan.listingStep = input.listingStep;
        if (input.reconcileOnly) {
            for (const target of plan.targets)
                target.state = "UNCERTAIN";
            if (plan.listingStep)
                plan.listingStep.state = "UNCERTAIN";
        }
        await prisma.listingOperation.create({ data: { requestKey: input.requestKey, jobId: input.requestKey, productId: product.id, storeId: input.storeId,
                stage: "PREPARED", holdGeneration: product.holdGeneration, expectedProductUpdatedAt: product.updatedAt,
                preparedPayload: json(plan), targetPrices: json(plan.targets.map(t => ({ sku: t.target.sku, price: t.desired.price }))),
                targetQuantities: json(plan.targets.map(t => ({ sku: t.target.sku, quantity: t.desired.quantity }))) } });
    }
    const save = async (p: InventoryPlan) => {
        const result = inventorySummary(p);
        const locallyApplied = p.targets.every(t => t.state === "CONFIRMED" && t.applied) && (!p.listingStep || p.listingStep.applied);
        await prisma.listingOperation.update({ where: { requestKey: input.requestKey }, data: { preparedPayload: json(p),
                stage: result.success && locallyApplied ? "COMPLETED" : result.outcomeUncertain ? "RECONCILIATION" : p.targets.some(t => t.state === "REJECTED") || p.listingStep?.state === "REJECTED" ? "FAILED" : "PREPARED",
                lastError: result.errorMessage ?? null, ...(result.success && locallyApplied ? { completedAt: new Date(), ebayConfirmedAt: new Date() } : {}) } });
    };
    const validateCurrent = (current: typeof product | null) => {
        if (!current || current.ebayItemId !== plan.itemId || current.holdGeneration !== plan.context.holdGeneration || current.status !== plan.context.status ||
            current.asin !== plan.context.asin || current.amazonPriceTrackingMode !== plan.context.trackingMode)
            throw new Error("Listing context changed before the inventory update.");
        if((current.lastPriceCheck?.toISOString()??null)!==plan.context.lastPriceCheck||(current.holdLastObservationId??null)!==plan.context.holdLastObservationId)throw new Error("Committed listing evidence changed before the inventory update.");
        if (current.quantity !== plan.context.productQuantity)
            throw new Error("Listing quantity changed before the update.");
        for (const [key, expected] of Object.entries(plan.context.listingValues as Record<string, unknown>)) {
            const confirmedPatch = plan.listingStep?.state === "CONFIRMED" ? plan.listingStep.patch[key] : undefined;
            const actual = JSON.stringify((current as unknown as Record<string, unknown>)[key]);
            if (actual !== JSON.stringify(confirmedPatch === undefined ? expected : confirmedPatch) && !(plan.listingStep?.state === "CONFIRMED" && !plan.listingStep.applied && actual === JSON.stringify(expected)))
                throw new Error("Listing fields changed before the inventory update.");
        }
        const before = plan.context.variants as Array<Record<string, unknown>>;
        const primary=plan.targets.find(t=>before.length?t.target.variantId===before[0].id:!t.target.variantId);
        const expectedPrice=primary?.state==="CONFIRMED"&&primary.desired.price!==undefined?primary.desired.price:plan.context.productPrice;
        if(Number(current.price)!==Number(expectedPrice)&&!(primary?.state==="CONFIRMED"&&!primary.applied&&Number(current.price)===Number(plan.context.productPrice)))throw new Error("Listing price changed before the inventory update.");
        if (current.variants.length !== before.length)
            throw new Error("Saved variation structure changed before the update.");
        for (const b of before) {
            const v = current.variants.find(v => v.id === b.id);
            const t = plan.targets.find(t => t.target.variantId === b.id), patch = t?.state === "CONFIRMED" ? t.desired.localPatch : undefined;
            if (!v || v.sku !== b.sku)
                throw new Error("Saved variation SKU changed before the inventory update.");
            for (const key of ["sellPrice", "buyPrice", "quantity", "feesPercent", "feesFixed", "profitPercent", "profitFixed", "roundCents"] as const) {
                const expected = patch && Object.prototype.hasOwnProperty.call(patch,key) ? patch[key] : (t?.state === "CONFIRMED" && key === "sellPrice" ? t.desired.price : undefined) ?? (t?.state === "CONFIRMED" && key === "quantity" ? t.desired.quantity : undefined) ?? b[key];
                const equal = (a: unknown, b: unknown) => (a == null || b == null) ? a === b : Number(a) === Number(b);
                if (!equal(v[key], expected) && !(t?.state === "CONFIRMED" && !t.applied && equal(v[key], b[key])))
                    throw new Error("Variation values changed before the inventory update.");
            }
        }
    };
    const assertCurrent = async () => { await input.assertCurrent?.(); validateCurrent(await prisma.product.findFirst({ where: { id: product.id, storeId: input.storeId }, include: { variants: true } })); };
    const apply = async (t: InventoryResult) => {
        await input.assertCurrent?.();
        await prisma.$transaction(async (tx) => {
            const current = await tx.product.findFirst({ where: { id: product.id, storeId: input.storeId }, include: { variants: { orderBy: { createdAt: "asc" } } } });
            validateCurrent(current);
            if (!current)
                throw new Error("Listing identity changed while confirming inventory.");
            if (t.target.variantId) {
                const variant = current.variants.find(v => v.id === t.target.variantId);
                if (!variant || (t.target.variation && variant.sku !== t.target.sku))
                    throw new Error("Variation identity changed while confirming inventory.");
                const patch = { ...(t.desired.localPatch ?? {}), ...(t.desired.price !== undefined ? { sellPrice: t.desired.price } : {}), ...(t.desired.quantity !== undefined ? { quantity: t.desired.quantity } : {}) };
                await tx.variant.update({ where: { id: variant.id }, data: patch as Prisma.VariantUpdateInput });
                if (current.variants[0]?.id === variant.id && t.desired.price !== undefined)
                    await tx.product.update({ where: { id: current.id }, data: { price: t.desired.price } });
            }
            else if (!t.target.variation && t.desired.price !== undefined)
                await tx.product.update({ where: { id: current.id }, data: { price: t.desired.price } });
        });
    };
    let firstSnapshot = snapshot;
    return executeInventory(plan, {
        read: async () => { if (firstSnapshot) {
            const result = firstSnapshot;
            firstSnapshot = undefined;
            return result;
        } return readEbayInventory(plan.itemId, storeNumber); },
        write: xml => callEbayReviseInventoryStatus(xml, storeNumber), save, assertCurrent, apply,
        listingWrite: xml => callEbayReviseItem(xml, storeNumber),
        applyListing: async (patch) => { await assertCurrent(); await prisma.$transaction(async (tx) => { validateCurrent(await tx.product.findFirst({ where: { id: product.id, storeId: input.storeId }, include: { variants: true } })); await tx.product.update({ where: { id: product.id }, data: patch as Prisma.ProductUpdateInput }); }); },
        retryRejected: input.retryRejected
    });
}

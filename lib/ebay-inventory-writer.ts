import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { callEbayGetItem, callEbayReviseInventoryStatus, callEbayReviseItem, getStoreNumber } from "@/lib/ebay";
import { buildGetItemXML } from "./ebay-xml";
import { executeInventory, inventorySummary, parseInventorySnapshot, planInventory, type InventoryAuthorization, type InventoryPlan, type InventoryRequest, type InventoryResult, type InventorySnapshot } from "./ebay-inventory";
import { canonicalInventoryJson, resolveDeferredPricing, shippingSettingsContext, type DeferredPriceSource } from "./ebay-deferred-pricing";
import { settleDeferredInventory } from "./ebay-deferred-settlement";
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
    authorization?: InventoryAuthorization;
    deferredSources?: DeferredPriceSource[];
};
export async function writeEbayInventory(input: InventoryWriteInput) {
    const product = await prisma.product.findFirst({ where: { id: input.productId, storeId: input.storeId }, include: { variants: { orderBy: { createdAt: "asc" } }, priceHistory: { where: { appliedAt: null } }, listingOperations: { where: { stage: "FAILED" } } } });
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
        if (saved?.kind !== "ebay-inventory" || ![1, 2].includes(saved.version))
            throw new Error("Legacy inventory update needs reconciliation before retry.");
        plan = saved;
        if (plan.context.intent !== intent) {
            const previous = JSON.parse(String(plan.context.intent)) as {
                requests: InventoryRequest[];
                allRemote: boolean;
                automaticRecovery: boolean;
            };
            const requested = JSON.parse(intent) as typeof previous;
            const same = (a: InventoryRequest, b: InventoryRequest) => a.variantId === b.variantId && a.price === b.price && a.quantity === b.quantity && canonicalInventoryJson(a.localPatch) === canonicalInventoryJson(b.localPatch);
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
        const settings = await prisma.supplierSettings.findUnique({ where: { storeId_supplierName: { storeId: input.storeId, supplierName: "Amazon AU" } }, select: { minProductQuantity: true, maxShippingDays: true, scrapePostcode: true } });
        if (input.deferredSources?.length) {
            const covered = resolveDeferredPricing(product, settings ?? undefined);
            const sorted = (links: DeferredPriceSource[]) => [...links].sort((a, b) => (a.requestKey + ":" + a.variantId).localeCompare(b.requestKey + ":" + b.variantId));
            if (covered.error || canonicalInventoryJson(sorted(covered.sources)) !== canonicalInventoryJson(sorted(input.deferredSources))) throw new Error(covered.error ?? "Deferred price authorization changed before restoration.");
            for (const source of covered.sources) if (!input.requests.some(r => r.variantId === source.variantId && r.price === source.price && r.quantity === 1)) throw new Error("Restoration must include the authorized price and quantity together.");
            for (const source of covered.sources) {
                const original = (product.listingOperations.find(o => o.requestKey === source.requestKey)?.preparedPayload as unknown as InventoryPlan).targets.find(t => t.target.variantId === source.variantId)!;
                const current = snapshot.entries.find(e => e.sku === source.sku);
                if (!current || (current.quantity !== 0 && !(current.quantity === 1 && current.price === source.price)) || (current.price !== original.before.price && current.price !== source.price)) throw new Error("Current eBay price or stock changed. Review before restoring the deferred price.");
            }
        }
        plan = planInventory({ storeId: input.storeId, productId: product.id, itemId: product.ebayItemId, currency: String(specifics?._Currency ?? "AUD"),
            variants: product.variants, requests: input.requests, snapshot, allRemote: input.allRemote, automaticRecovery: input.automaticRecovery,
            context: { intent, authorization: input.authorization ?? { source: "EXPLICIT_EDIT" }, supplierContext: shippingSettingsContext(settings ?? undefined), deferredSources: input.deferredSources ?? [], productPrice:Number(product.price),lastPriceCheck:product.lastPriceCheck?.toISOString()??null,holdLastObservationId:product.holdLastObservationId??null,productQuantity: product.quantity, listingValues: { title: product.title, description: product.description, itemSpecifics: product.itemSpecifics, images: product.images, shippingPolicyId: product.shippingPolicyId, returnPolicyId: product.returnPolicyId, paymentPolicyId: product.paymentPolicyId, templateId: product.templateId, policyTemplateId: product.policyTemplateId }, holdGeneration: product.holdGeneration, status: product.status, asin: product.asin, trackingMode: product.amazonPriceTrackingMode,
                deferredSourcePayloads: (input.deferredSources ?? []).map(s => ({ requestKey: s.requestKey, payload: product.listingOperations.find(o => o.requestKey === s.requestKey)?.preparedPayload })),
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
        // A newly authorized request replaces only the explicitly represented
        // deferred targets. Preserve the old intent; never carry its approval.
        if (!input.deferredSources?.length && plan.targets.some(t => t.desired.price !== undefined)) {
            await prisma.$transaction(async tx => {
                await tx.$queryRaw(Prisma.sql`SELECT id FROM "Product" WHERE id = ${product.id} FOR UPDATE`);
                const oldPlans = await tx.listingOperation.findMany({ where: { productId: product.id, storeId: input.storeId, stage: "FAILED", requestKey: { not: input.requestKey }, preparedPayload: { path: ["kind"], equals: "ebay-inventory" } } });
                for (const old of oldPlans) {
                    const previous = old.preparedPayload as unknown as InventoryPlan;
                    if (previous.version !== 2) continue;
                    let changed = false;
                    for (const target of previous.targets.filter(t => t.state === "DEFERRED" && !t.resolvedBy && !t.supersededBy)) {
                        const replacement = plan.targets.find(t => t.target.variantId === target.target.variantId && t.target.sku === target.target.sku && t.desired.price !== undefined);
                        if (!replacement) continue;
                        target.supersededBy = input.requestKey; target.error = "Price intent replaced by a newly authorized update."; changed = true;
                        const ids = (target.desired.priceHistoryIds ?? []).filter(id => !replacement.desired.priceHistoryIds?.includes(id));
                        if (ids.length) await tx.priceHistory.updateMany({ where: { id: { in: ids }, productId: product.id, appliedAt: null }, data: { status: "SUPERSEDED", appliedAt: new Date(), ebayRevised: false, errorMessage: "Replaced by a newly authorized price intent." } });
                    }
                    if (changed) {
                        await tx.listingOperation.update({ where: { requestKey: old.requestKey }, data: { preparedPayload: json(previous) } });
                        const sourceJobId = (previous.context.authorization as InventoryAuthorization | undefined)?.sourceJobId;
                        if (sourceJobId) {
                            await tx.$queryRaw(Prisma.sql`SELECT id FROM "EbayActionJob" WHERE id = ${sourceJobId} FOR UPDATE`);
                            const job = await tx.ebayActionJob.findUnique({ where: { id: sourceJobId } });
                            const errors = Array.isArray(job?.errors) ? job.errors.map(e => e && typeof e === "object" && !Array.isArray(e) && e.productId === product.id ? { ...e, error: "Price intent replaced by a newly authorized update.", awaitingRestoration: previous.targets.filter(t => t.state === "DEFERRED" && !t.supersededBy).length, variationResults: previous.targets } : e) : [];
                            if (job) await tx.ebayActionJob.update({ where: { id: sourceJobId }, data: { errors: json(errors) } });
                        }
                    }
                }
            });
        }
    }
    const save = async (p: InventoryPlan) => {
        const result = inventorySummary(p);
        const locallyApplied = p.targets.every(t => t.state === "CONFIRMED" && t.applied) && (!p.listingStep || p.listingStep.applied);
        const settlementPending = Array.isArray(p.context.deferredSources) && p.context.deferredSources.length > 0 && p.context.deferredSettlementCompleted !== true;
        await prisma.listingOperation.update({ where: { requestKey: input.requestKey }, data: { preparedPayload: json(p),
                stage: result.success && locallyApplied ? settlementPending ? "RECONCILIATION" : "COMPLETED" : result.outcomeUncertain ? "RECONCILIATION" : p.targets.some(t => t.state === "REJECTED" || t.state === "DEFERRED") || p.listingStep?.state === "REJECTED" ? "FAILED" : "PREPARED",
                lastError: result.errorMessage ?? (settlementPending && result.success ? "Deferred price settlement needs verification." : null), ...(result.success && locallyApplied && !settlementPending ? { completedAt: new Date(), ebayConfirmedAt: new Date() } : {}) } });
    };
    const validateCurrent = (current: Omit<typeof product, "priceHistory" | "listingOperations"> | null) => {
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
    const assertCurrent = async () => {
        await input.assertCurrent?.();
        validateCurrent(await prisma.product.findFirst({ where: { id: product.id, storeId: input.storeId }, include: { variants: true } }));
        const settings = await prisma.supplierSettings.findUnique({ where: { storeId_supplierName: { storeId: input.storeId, supplierName: "Amazon AU" } }, select: { minProductQuantity: true, maxShippingDays: true, scrapePostcode: true } });
        if (plan.version === 2 && plan.context.supplierContext && canonicalInventoryJson(plan.context.supplierContext) !== canonicalInventoryJson(shippingSettingsContext(settings ?? undefined))) throw new Error("Supplier settings changed before the inventory update.");
        for (const source of (plan.context.deferredSourcePayloads ?? []) as Array<{ requestKey: string; payload: unknown }>) {
            const current = await prisma.listingOperation.findUnique({ where: { requestKey: source.requestKey } });
            const payload = current?.preparedPayload as unknown as InventoryPlan | undefined;
            const links = (plan.context.deferredSources ?? []) as DeferredPriceSource[];
            const represented = payload?.targets.filter(t => links.some(l => l.requestKey === source.requestKey && l.variantId === t.target.variantId));
            const settledHere = represented?.length && represented.every(t => t.resolvedBy === input.requestKey);
            if (!settledHere && canonicalInventoryJson(current?.preparedPayload) !== canonicalInventoryJson(source.payload)) throw new Error("Deferred approval changed before the restoration write.");
            for (const link of links.filter(l => l.requestKey === source.requestKey && l.historyIds.length)) {
                const histories = await prisma.priceHistory.findMany({ where: { id: { in: link.historyIds }, productId: product.id, variantId: link.variantId } });
                if (histories.length !== link.historyIds.length || histories.some(h => Number(h.newSellPrice) !== link.price || (h.appliedAt !== null && !(settledHere && h.status === "APPLIED" && h.ebayRevised)))) throw new Error("Deferred price approval changed before restoration.");
                const desiredBuyPrice = plan.targets.find(t => t.target.variantId === link.variantId)?.desired.localPatch?.buyPrice;
                if (desiredBuyPrice !== undefined && histories.some(h => Number(h.newPrice) !== Number(desiredBuyPrice))) throw new Error("Approved Amazon cost changed before restoration.");
            }
        }
    };
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
    const result = await executeInventory(plan, {
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
    if (result.success) {
        await settleDeferredInventory(input.requestKey, plan, input.assertCurrent);
        plan.context.deferredSettlementCompleted = true;
        await save(plan);
    }
    return result;
}

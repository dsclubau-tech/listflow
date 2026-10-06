import { XMLParser, XMLValidator } from "fast-xml-parser";
import { buildReviseInventoryStatusXML } from "./ebay-xml";
export const INVENTORY_OPERATION_VERSION = 1;
export type InventoryError = {
    code: string;
    severity: string;
    message: string;
    parameters: Record<string, string>;
    system: boolean;
};
export type InventoryTarget = {
    storeId: string;
    productId: string;
    variantId?: string;
    itemId: string;
    sku?: string;
    variation: boolean;
    currency: string;
};
export type InventoryValue = {
    price: number;
    quantity: number;
};
export type InventorySnapshot = {
    itemId: string;
    status: string;
    tracking: string;
    currency: string;
    sku?: string;
    variation: boolean;
    entries: Array<{
        sku?: string;
    } & InventoryValue>;
    listing?: Record<string, unknown>;
};
export type InventoryRequest = {
    variantId?: string;
    price?: number;
    quantity?: number;
    localPatch?: Record<string, unknown>;
};
export type InventoryResult = {
    target: InventoryTarget;
    desired: InventoryRequest;
    before: InventoryValue;
    state: "PENDING" | "CONFIRMED" | "REJECTED" | "UNCERTAIN";
    error?: string;
    errors?: InventoryError[];
    retryEligible?: boolean;
    applied?: boolean;
};
export type InventoryPlan = {
    kind: "ebay-inventory";
    version: 1;
    storeId: string;
    productId: string;
    itemId: string;
    context: Record<string, unknown>;
    targets: InventoryResult[];
    listingStep?: {
        state: "PENDING" | "CONFIRMED" | "UNCERTAIN" | "REJECTED";
        xml: string;
        patch: Record<string, unknown>;
        error?: string;
        applied?: boolean;
        retryEligible?: boolean;
    };
};
export type InventoryResponse = {
    success: boolean;
    errorMessage?: string;
    outcomeUncertain?: boolean;
    errors?: InventoryError[];
    results?: Array<{
        itemId: string;
        sku?: string;
    }>;
};
const list = <T>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
function assertInventoryXml(xml: string) {
    if (xml.length > 8 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
        throw new Error("Unsupported eBay XML response.");
}
function parseInventoryXml(xml: string) {
    // Trading responses may contain long HTML descriptions escaped as ordinary XML.
    // Reject document-defined entities and bound the input before scaling the limits
    // for predefined/numeric references, whose decoded content cannot grow the input.
    assertInventoryXml(xml);
    return new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: false,
        processEntities: { enabled: true, maxTotalExpansions: Math.max(1000, xml.length), maxExpandedLength: Math.max(100000, xml.length) }
    }).parse(xml);
}
function value(input: unknown): string {
    if (input && typeof input === "object")
        return String((input as Record<string, unknown>)["#text"] ?? "");
    return String(input ?? "");
}
function number(input: unknown, label: string): number {
    const n = Number(value(input));
    if (!Number.isFinite(n) || n < 0 || value(input) === "")
        throw new Error("Unverified eBay " + label + ".");
    return n;
}
export function inventoryErrors(input: unknown): InventoryError[] {
    return list(input as Record<string, unknown>[] | undefined).map(e => ({
        code: value(e.ErrorCode), severity: value(e.SeverityCode), message: value(e.LongMessage) || value(e.ShortMessage),
        system: value(e.ErrorClassification) === "SystemError",
        parameters: Object.fromEntries(list(e.ErrorParameters as Record<string, unknown>[] | undefined).map(p => [value(p["@_ParamID"]), value(p.Value)]))
    }));
}
export function parseInventoryResponse(xml: string): InventoryResponse {
    try { assertInventoryXml(xml); } catch { return { success: false, outcomeUncertain: true, errorMessage: "Invalid eBay inventory response." }; }
    if (XMLValidator.validate(xml) !== true)
        return { success: false, outcomeUncertain: true, errorMessage: "Invalid eBay inventory response." };
    let r;
    try { r = parseInventoryXml(xml).ReviseInventoryStatusResponse; } catch { return { success: false, outcomeUncertain: true, errorMessage: "Invalid eBay inventory response." }; }
    if (!r)
        return { success: false, outcomeUncertain: true, errorMessage: "Missing eBay inventory response." };
    const errors = inventoryErrors(r.Errors), ack = value(r.Ack).trim();
    return { success: ack === "Success" || ack === "Warning", errors,
        results: list(r.InventoryStatus as Record<string, unknown>[] | undefined).map(e => ({ itemId: value(e.ItemID), ...(e.SKU !== undefined ? { sku: value(e.SKU) } : {}) })),
        ...(ack !== "Success" && ack !== "Warning" ? { errorMessage: errors.map(e => e.message).join("; ") || "Unrecognized eBay response.", outcomeUncertain: !["Failure", "PartialFailure"].includes(ack) } : {}) };
}
export function parseInventorySnapshot(xml: string, expectedItemId: string): InventorySnapshot {
    assertInventoryXml(xml);
    if (XMLValidator.validate(xml) !== true)
        throw new Error("Invalid eBay GetItem response.");
    const response = parseInventoryXml(xml).GetItemResponse;
    if (!response || !["Success", "Warning"].includes(value(response.Ack).trim()) || !response.Item)
        throw new Error(inventoryErrors(response?.Errors).map(e => e.message).join("; ") || "Cannot verify the eBay listing.");
    const item = response.Item;
    if (value(item.ItemID) !== expectedItemId)
        throw new Error("eBay listing identity does not match.");
    const status = value(item.SellingStatus?.ListingStatus).trim();
    if (status !== "Active")
        throw new Error(status === "Completed" || status === "Ended" ? "This eBay listing has ended." : "eBay listing status cannot be verified.");
    const variation = item.Variations !== undefined;
    const entries = list((variation ? item.Variations?.Variation : item) as Record<string, unknown>[] | undefined).map(v => {
        const total = number(v.Quantity, "quantity");
        const quantity = v.QuantityAvailable !== undefined ? number(v.QuantityAvailable, "available quantity") : total - number((v.SellingStatus as Record<string, unknown>)?.QuantitySold ?? "0", "sold quantity");
        const price = number(v.StartPrice ?? (v.SellingStatus as Record<string, unknown>)?.CurrentPrice, "price");
        if (!Number.isInteger(quantity) || quantity < 0 || price <= 0)
            throw new Error("Invalid eBay inventory values.");
        return { ...(v.SKU !== undefined ? { sku: value(v.SKU) } : {}), price, quantity };
    });
    if (!entries.length)
        throw new Error("eBay variations could not be verified.");
    const currency = value((variation ? list(item.Variations.Variation)[0] : item).StartPrice?.["@_currencyID"] ?? item.Currency ?? item.SellingStatus?.CurrentPrice?.["@_currencyID"]).trim();
    if (!currency)
        throw new Error("eBay currency cannot be verified.");
    if(item.Currency!==undefined&&value(item.Currency).trim()!==currency)throw new Error("Inconsistent eBay listing currency.");
    for (const v of list(item.Variations?.Variation as Record<string, unknown>[] | undefined))
        if (value((v.StartPrice as Record<string, unknown>)?.["@_currencyID"]) !== currency)
            throw new Error("Inconsistent eBay variation currencies.");
    return { itemId: expectedItemId, status, tracking: value(item.InventoryTrackingMethod ?? "ItemID").trim(), currency, variation, sku: item.SKU === undefined ? undefined : value(item.SKU), entries, listing: item };
}
export function planInventory(input: {
    storeId: string;
    productId: string;
    itemId: string;
    currency: string;
    variants: Array<{
        id: string;
        sku: string | null;
    }>;
    requests: InventoryRequest[];
    snapshot: InventorySnapshot;
    allRemote?: boolean;
    automaticRecovery?: boolean;
    context?: Record<string, unknown>;
}): InventoryPlan {
    const s = input.snapshot;
    if (s.itemId !== input.itemId || s.status !== "Active")
        throw new Error("This eBay listing has ended or changed.");
    if (s.currency !== input.currency)
        throw new Error("Unexpected eBay listing currency.");
    const seen = new Set<string>();
    for (const v of s.entries)
        if (s.variation) {
            if (!v.sku || seen.has(v.sku))
                throw new Error("The eBay listing contains missing or duplicate variation SKUs.");
            seen.add(v.sku);
        }
    const local = new Map(input.variants.map(v => [v.id, v]));
    const localSkus = new Set<string>();
    for (const v of input.variants)
        if (s.variation) {
            if (!v.sku || localSkus.has(v.sku))
                throw new Error("Saved variations contain missing or duplicate SKUs.");
            localSkus.add(v.sku);
        }
    if (input.automaticRecovery && s.variation && s.entries.length !== 1)
        throw new Error("These variations need verification before stock can be restored.");
    const requests = input.allRemote ? s.entries.map(e => ({ ...input.requests[0], variantId: input.variants.find(v => v.sku === e.sku)?.id, remoteSku: e.sku })) : input.requests;
    const addressed = new Set<string>();
    const targets = requests.map(r => {
        const variant = r.variantId ? local.get(r.variantId) : undefined;
        if (r.variantId && !variant)
            throw new Error("Saved variation no longer exists.");
        const sku = s.variation ? ("remoteSku" in r ? r.remoteSku as string : variant?.sku ?? undefined) : s.tracking === "SKU" ? s.sku : undefined;
        if ((s.variation || s.tracking === "SKU") && !sku)
            throw new Error("The saved variation SKU no longer matches this eBay listing.");
        const before = s.variation ? s.entries.find(v => v.sku === sku) : s.entries[0];
        if (!before)
            throw new Error("The saved variation SKU no longer matches this eBay listing.");
        const key = sku ?? input.itemId;
        if (addressed.has(key))
            throw new Error("Multiple local variations address the same eBay target.");
        addressed.add(key);
        if (r.price !== undefined && (!Number.isFinite(r.price) || r.price <= 0))
            throw new Error("Invalid variation price.");
        if (r.quantity !== undefined && (!Number.isInteger(r.quantity) || r.quantity < 0))
            throw new Error("Invalid variation quantity.");
        if (r.price === undefined && r.quantity === undefined)
            throw new Error("No inventory change requested.");
        return { target: { storeId: input.storeId, productId: input.productId, variantId: r.variantId, itemId: input.itemId, sku, variation: s.variation, currency: s.currency },
            desired: { variantId: r.variantId, price: r.price, quantity: r.quantity, localPatch: r.localPatch }, before: { price: before.price, quantity: before.quantity }, state: "PENDING" as const };
    });
    return { kind: "ebay-inventory", version: 1, storeId: input.storeId, productId: input.productId, itemId: input.itemId, context: { remoteSkus: s.entries.map(e => e.sku ?? null), inventoryTracking: s.tracking, itemSku: s.sku ?? null, ...input.context }, targets };
}
export function matchesInventory(result: InventoryResult, snapshot: InventorySnapshot) {
    if (snapshot.itemId !== result.target.itemId || snapshot.currency !== result.target.currency || snapshot.variation !== result.target.variation)
        return false;
    const found = snapshot.entries.filter(e => result.target.variation ? e.sku === result.target.sku : true);
    if (found.length !== 1)
        return false;
    return (result.desired.price === undefined || Math.round(found[0].price * 100) === Math.round(result.desired.price * 100)) &&
        (result.desired.quantity === undefined || found[0].quantity === result.desired.quantity);
}
export function verifyListingStep(xml: string, snapshot: InventorySnapshot): boolean {
    if (!snapshot.listing)
        return false;
    const request = parseInventoryXml(xml).ReviseItemRequest?.Item as Record<string, unknown> | undefined;
    if (!request || value(request.ItemID) !== snapshot.itemId)
        return false;
    const contains = (expected: unknown, actual: unknown): boolean => {
        if (Array.isArray(expected)) {
            const found = list(actual);
            if (expected.length !== found.length)
                return false;
            const remaining = [...found];
            return expected.every(e => { const index = remaining.findIndex(a => contains(e, a)); if (index < 0)
                return false; remaining.splice(index, 1); return true; });
        }
        if (expected && typeof expected === "object") {
            return !!actual && typeof actual === "object" && Object.entries(expected).every(([key, v]) => contains(v, (actual as Record<string, unknown>)[key]));
        }
        return value(expected) === value(actual);
    };
    return Object.entries(request).filter(([key]) => key !== "ItemID").every(([key, v]) => contains(v, snapshot.listing![key]));
}
export function inventorySummary(plan: InventoryPlan) {
    const confirmed = plan.targets.filter(t => t.state === "CONFIRMED").length, uncertain = plan.targets.some(t => t.state === "UNCERTAIN") || plan.listingStep?.state === "UNCERTAIN";
    const success = confirmed === plan.targets.length && (!plan.listingStep || plan.listingStep.state === "CONFIRMED");
    return { success, outcomeUncertain: uncertain, variationResults: plan.targets,
        retryEligible: uncertain || plan.listingStep?.state === "PENDING" || plan.listingStep?.retryEligible === true || plan.targets.some(t => t.state === "PENDING" || t.retryEligible === true),
        errorMessage: success ? undefined : uncertain ? "Update result needs verification." : confirmed ? confirmed + " of " + plan.targets.length + " variations updated; remaining variations could not be updated." : plan.targets.find(t => t.error)?.error ?? plan.listingStep?.error ?? "Inventory update was not completed." };
}
export async function executeInventory(plan: InventoryPlan, io: {
    read: () => Promise<InventorySnapshot>;
    write: (xml: string) => Promise<InventoryResponse>;
    save: (plan: InventoryPlan) => Promise<void>;
    assertCurrent: () => Promise<void>;
    apply: (target: InventoryResult) => Promise<void>;
    listingWrite?: (xml: string) => Promise<InventoryResponse>;
    applyListing?: (patch: Record<string, unknown>) => Promise<void>;
    retryRejected?: boolean;
}) {
    if (plan.kind !== "ebay-inventory" || plan.version !== 1)
        throw new Error("Unsupported inventory operation version.");
    const applyConfirmed = async () => { for (const t of plan.targets)
        if (t.state === "CONFIRMED" && !t.applied) {
            await io.apply(t);
            t.applied = true;
            await io.save(plan);
        } };
    await io.assertCurrent();
    let current = await io.read();
    const structureMatches = (snapshot: InventorySnapshot) => snapshot.variation === plan.targets[0]?.target.variation || plan.targets.length === 0;
    const sameStructure = (snapshot: InventorySnapshot) => structureMatches(snapshot) && snapshot.tracking === plan.context.inventoryTracking &&
        JSON.stringify(snapshot.entries.map(e => e.sku ?? null).sort()) === JSON.stringify([...(plan.context.remoteSkus as Array<string | null>)].sort());
    for (const t of plan.targets)
        if (t.state === "UNCERTAIN") {
            if (matchesInventory(t, current) && sameStructure(current)) {
                t.state = "CONFIRMED";
                t.error = undefined;
            }
            else
                t.error = "Update result needs verification. The current eBay value differs; no automatic resend.";
        }
    if (plan.listingStep?.state === "UNCERTAIN" && verifyListingStep(plan.listingStep.xml, current)) {
        plan.listingStep.state = "CONFIRMED";
        plan.listingStep.error = undefined;
    }
    await io.save(plan);
    await applyConfirmed();
    if (plan.targets.some(t => t.state === "UNCERTAIN") || plan.listingStep?.state === "UNCERTAIN")
        return inventorySummary(plan);
    if (plan.listingStep && plan.listingStep.state !== "CONFIRMED") {
        if (plan.listingStep.state === "REJECTED" && (!io.retryRejected || !plan.listingStep.retryEligible))
            return inventorySummary(plan);
        if (!io.listingWrite)
            throw new Error("Missing listing update handler.");
        await io.assertCurrent();
        plan.listingStep.state = "UNCERTAIN";
        await io.save(plan);
        let response: InventoryResponse;
        try {
            response = await io.listingWrite(plan.listingStep.xml);
        }
        catch (error) {
            response = { success: false, outcomeUncertain: true, errorMessage: String(error) };
        }
        let verified = false;
        try {
            current = await io.read();
            verified = verifyListingStep(plan.listingStep.xml, current);
        }
        catch { /* Keep uncertain listing writes for reconciliation. */ }
        plan.listingStep.state = verified ? "CONFIRMED" : response.outcomeUncertain || response.success ? "UNCERTAIN" : "REJECTED";
        plan.listingStep.retryEligible = plan.listingStep.state === "REJECTED" && !!response.errors?.length && response.errors.every(e => e.system);
        plan.listingStep.error = verified ? undefined : response.errorMessage ?? "Listing update needs verification.";
        await io.save(plan);
        if (!verified)
            return inventorySummary(plan);
    }
    if (plan.listingStep?.state === "CONFIRMED" && !plan.listingStep.applied) {
        await io.applyListing?.(plan.listingStep.patch);
        plan.listingStep.applied = true;
        await io.save(plan);
    }
    if (!sameStructure(current))
        throw new Error("eBay variation structure changed before the inventory update.");
    const pending = plan.targets.filter(t => t.state === "PENDING" || (io.retryRejected && t.state === "REJECTED" && t.retryEligible));
    for (let offset = 0; offset < pending.length; offset += 4) {
        await io.assertCurrent();
        const batch = pending.slice(offset, offset + 4);
        for (const t of batch) {
            if (current.variation !== t.target.variation || current.currency !== t.target.currency || current.itemId !== t.target.itemId || !current.entries.some(e => !t.target.variation || e.sku === t.target.sku))
                throw new Error("eBay inventory mapping changed before the update.");
            const now = current.entries.find(e => !t.target.variation || e.sku === t.target.sku)!;
            if ((t.desired.price !== undefined && now.price !== t.before.price) || (t.desired.quantity !== undefined && now.quantity !== t.before.quantity)) {
                t.state = "UNCERTAIN";
                t.error = "Inventory changed before the write. Review current values.";
                await io.save(plan);
                return inventorySummary(plan);
            }
        }
        for (const t of batch)
            t.state = "UNCERTAIN";
        await io.save(plan);
        let response: InventoryResponse;
        try {
            response = await io.write(buildReviseInventoryStatusXML(batch.map(t => ({ ebayItemId: t.target.itemId, sku: t.target.sku, startPrice: t.desired.price, quantity: t.desired.quantity }))));
        }
        catch (error) {
            response = { success: false, outcomeUncertain: true, errorMessage: String(error) };
        }
        let readback: InventorySnapshot | undefined;
        try {
            readback = await io.read();
        }
        catch { /* A failed read never proves the write failed. */ }
        for (const t of batch) {
            const errors = response.errors?.filter(e => e.severity === "Error" && (!Object.keys(e.parameters).length || Object.values(e.parameters).includes(t.target.sku ?? t.target.itemId)));
            if (readback && sameStructure(readback) && matchesInventory(t, readback)) {
                t.state = "CONFIRMED";
                t.error = undefined;
            }
            else if (!response.outcomeUncertain && !response.success && errors?.length) {
                t.state = "REJECTED";
                t.errors = errors;
                t.error = errors.map(e => e.message).join("; ");
                t.retryEligible = errors.every(e => e.system);
            }
            else {
                t.state = "UNCERTAIN";
                t.error = response.errorMessage || "Update result needs verification.";
            }
        }
        if (readback)
            current = readback;
        await io.save(plan);
        await applyConfirmed();
        if (batch.some(t => t.state !== "CONFIRMED"))
            break;
    }
    return inventorySummary(plan);
}

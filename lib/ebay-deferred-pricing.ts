import type { InventoryAuthorization, InventoryPlan, InventoryRequest } from "./ebay-inventory";

type VariantContext = { id: string; sku: string | null; buyPrice: unknown; sellPrice: unknown; quantity: number; feesPercent: number; feesFixed: number; profitPercent: number; profitFixed: number; roundCents: number | null };
export type DeferredPricingProduct = {
  id?: string; storeId?: string; ebayItemId?: string | null; asin?: string | null;
  status?: string; holdGeneration?: number; amazonPriceTrackingMode?: string;
  lastPriceCheck?: Date | null; holdLastObservationId?: string | null;
  variants?: VariantContext[];
  listingOperations?: Array<{ requestKey: string; preparedPayload: unknown }>;
  priceHistory?: Array<{ id: string; variantId: string | null; newSellPrice: unknown; newPrice?: unknown }>;
};
export type DeferredPriceSource = { requestKey: string; variantId: string; sku: string; price: number; historyIds: string[] };
export function canonicalInventoryJson(value: unknown): string {
  const ordered = (v: unknown): unknown => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(ordered) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, ordered(value)])) : v;
  return JSON.stringify(ordered(value)) ?? "undefined";
}
export function shippingSettingsContext(settings?: { minProductQuantity?: number; maxShippingDays: number; scrapePostcode: string }) {
  return { minProductQuantity: settings?.minProductQuantity ?? 2, maxShippingDays: settings?.maxShippingDays ?? 25, scrapePostcode: settings?.scrapePostcode ?? "2217" };
}

// This is authorization coverage, not an exception to stock/identity/shipping checks.
export function resolveDeferredPricing(product: DeferredPricingProduct, settings?: { minProductQuantity?: number; maxShippingDays: number; scrapePostcode: string }) {
  // Confirmed restoration checkpoints can have applied local fields before the
  // final hold transition. Validate those exact changes against the durable plan.
  product = restorationPricingView(product);
  const requests: InventoryRequest[] = [], sources: DeferredPriceSource[] = [], coveredHistoryIds = new Set<string>();
  const seen = new Set<string>();
  const fail = (message: string) => ({ requests: [], sources: [], coveredHistoryIds: [] as string[], error: message });
  for (const operation of product.listingOperations ?? []) {
    const plan = operation.preparedPayload as InventoryPlan;
    if (plan?.kind === "ebay-inventory" && plan.version === 2 && (!Array.isArray(plan.targets) || !plan.context || typeof plan.context !== "object")) return fail("The saved inventory plan needs review before restoration.");
    if (plan?.kind !== "ebay-inventory" || plan.version !== 2 || !plan.targets.some(t => t.state === "DEFERRED" && !t.resolvedBy && !t.supersededBy)) continue;
    const authorization = plan.context.authorization as InventoryAuthorization | undefined;
    if (!authorization || !["EXPLICIT_EDIT", "PRICE_APPROVAL", "AUTOMATIC_POLICY"].includes(authorization.source)) return fail("Price review required before restoration.");
    if (plan.storeId !== product.storeId || plan.productId !== product.id || plan.itemId !== product.ebayItemId ||
        plan.context.asin !== product.asin || plan.context.trackingMode !== product.amazonPriceTrackingMode ||
        plan.context.holdGeneration !== product.holdGeneration || plan.context.status !== product.status ||
        plan.context.lastPriceCheck !== (product.lastPriceCheck?.toISOString() ?? null) ||
        plan.context.holdLastObservationId !== (product.holdLastObservationId ?? null) ||
        canonicalInventoryJson(plan.context.supplierContext) !== canonicalInventoryJson(shippingSettingsContext(settings)))
      return fail("The deferred price context changed. Review the current price before restoration.");
    const before = plan.context.variants as VariantContext[] | undefined;
    if (!before || !product.variants || before.length !== product.variants.length) return fail("Deferred variation identity needs review before restoration.");
    for (const target of plan.targets.filter(t => t.state === "DEFERRED" && !t.resolvedBy && !t.supersededBy)) {
      const v = product.variants.find(v => v.id === target.target.variantId), b = before.find(v => v.id === target.target.variantId);
      if (!v || !b || v.sku !== target.target.sku || b.sku !== v.sku || seen.has(v.id)) return fail("Conflicting deferred variation prices need review before restoration.");
      for (const key of ["buyPrice", "sellPrice", "quantity", "feesPercent", "feesFixed", "profitPercent", "profitFixed", "roundCents"] as const)
        if (v[key] == null || b[key] == null ? v[key] !== b[key] : Number(v[key]) !== Number(b[key])) return fail("The deferred pricing inputs changed. Review the current price before restoration.");
      if (!(Number(target.desired.price) > 0)) return fail("Deferred price is invalid.");
      const historyIds = target.desired.priceHistoryIds ?? [];
      if (authorization.source !== "EXPLICIT_EDIT" && !historyIds.length) return fail("Price review required before restoration.");
      for (const id of historyIds) {
        const h = product.priceHistory?.find(h => h.id === id);
        if (!h || h.variantId !== v.id || Number(h.newSellPrice) !== target.desired.price || !authorization.historyIds?.includes(id)) return fail("Price review required before restoration.");
        if (target.desired.localPatch?.buyPrice !== undefined && Number(h.newPrice) !== Number(target.desired.localPatch.buyPrice)) return fail("The approved Amazon cost changed. Price review required before restoration.");
        coveredHistoryIds.add(id);
      }
      seen.add(v.id);
      requests.push({ ...target.desired, quantity: 1 });
      sources.push({ requestKey: operation.requestKey, variantId: v.id, sku: target.target.sku!, price: target.desired.price!, historyIds });
    }
  }
  return { requests, sources, coveredHistoryIds: [...coveredHistoryIds], error: undefined as string | undefined };
}

export function restorationPricingView(product: DeferredPricingProduct): DeferredPricingProduct {
  const variants = product.variants?.map(v => ({ ...v }));
  if (!variants) return product;
  for (const operation of product.listingOperations ?? []) {
    const p = operation.preparedPayload as InventoryPlan;
    if (p?.kind !== "ebay-inventory" || p.version !== 2 || !Array.isArray(p.targets) || !Array.isArray(p.context?.deferredSources) || !p.context.deferredSources.length || p.productId !== product.id || p.storeId !== product.storeId || p.itemId !== product.ebayItemId || p.context.holdGeneration !== product.holdGeneration || p.context.status !== product.status) continue;
    const before = p.context.variants as VariantContext[];
    for (const t of p.targets.filter(t => t.state === "CONFIRMED" && t.applied)) {
      const v = variants.find(v => v.id === t.target.variantId), b = before.find(v => v.id === t.target.variantId);
      if (!v || !b || v.sku !== t.target.sku || Number(v.sellPrice) !== t.desired.price || v.quantity !== t.desired.quantity) continue;
      // Other pricing inputs remain unchanged and are checked by the resolver.
      v.sellPrice = b.sellPrice; v.quantity = b.quantity;
      for (const key of ["buyPrice", "feesPercent", "feesFixed", "profitPercent", "profitFixed", "roundCents"] as const) {
        const desired = t.desired.localPatch?.[key];
        if (desired !== undefined && (v[key] == null || desired == null ? v[key] === desired : Number(v[key]) === Number(desired)))
          Object.assign(v, { [key]: b[key] });
      }
    }
  }
  return { ...product, variants };
}

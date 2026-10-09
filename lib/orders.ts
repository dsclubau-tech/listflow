import { orderGroupKey } from "@/lib/order-notes";
import { getVariantDisplayProfit } from "@/lib/product-profit";
import { ORDER_STATUSES, type OrderStatus, type OrderRow } from "@/types/order";

type Money = number | string | { toString(): string } | null;
export type OrderMatchVariant = {
  id: string; sku: string | null; buyPrice: Money;
  feesPercent: number; feesFixed: number; images: string[];
};
export type OrderMatchProduct = {
  id: string; storeId: string; ebayItemId: string | null;
  asin: string | null; amazonPrice: Money; images: string[];
  promotedAdStatus: string; promotedAdPercent: number; promotedAdRateStrategy: string;
  variants: OrderMatchVariant[];
};
export type OrderIdentity = {
  ebayItemId: string | null; ebayVariationId: string | null; sku: string | null;
};
export type OrderMatch = { product: OrderMatchProduct; variant: OrderMatchVariant | null };

export function matchOrderProduct(storeId: string, line: OrderIdentity, candidates: OrderMatchProduct[]): OrderMatch | null {
  if (!line.ebayItemId) return null;
  const products = candidates.filter(p => p.storeId === storeId && p.ebayItemId === line.ebayItemId);
  if (products.length !== 1) return null;
  const product = products[0];
  if (line.sku) {
    const variants = product.variants.filter(v => v.sku === line.sku);
    if (variants.length === 1) return { product, variant: variants[0] };
    if (variants.length > 1 || product.variants.some(v => v.sku)) return null;
  }
  // A multiple-variation purchase needs a known variant identity.
  if (line.ebayVariationId || product.variants.length > 1) return null;
  return { product, variant: product.variants[0] ?? null };
}

export function orderAmounts(match: OrderMatch | null, sellTotal: number, quantity: number, currency: string) {
  if (!match) return { buyTotal: null, profit: null };
  const unitCost = match.variant?.buyPrice ?? match.product.amazonPrice;
  const buyPrice = unitCost === null ? NaN : Number(unitCost.toString());
  if (!Number.isFinite(buyPrice) || buyPrice < 0) return { buyTotal: null, profit: null };
  const buyTotal = Math.round(buyPrice * quantity * 100) / 100;
  // Listflow's existing supplier is Amazon AU. No exchange-rate formula exists.
  if (currency !== "AUD") return { buyTotal, profit: null };
  const result = getVariantDisplayProfit({
    buyPrice: buyTotal,
    sellPrice: sellTotal,
    feesPercent: match.variant?.feesPercent ?? 0,
    feesFixed: (match.variant?.feesFixed ?? 0) * quantity,
  }, match.product);
  return { buyTotal, profit: result?.profit ?? null };
}

export function toOrderRow(line: OrderIdentity & {
  id: string; storeId: string; accountKey: string; ebayOrderId: string; title: string; quantity: number; sellTotal: Money;
  currency: string; status: OrderStatus; estimatedArrival: string | null;
}, match: OrderMatch | null, internalNote: string | null = null): OrderRow {
  const sellTotal = Number(line.sellTotal?.toString());
  return {
    id: line.id, title: line.title, quantity: line.quantity,
    ebayOrderId: line.ebayOrderId, orderGroupKey: orderGroupKey(line), internalNote,
    matchedProductId: match?.product.id ?? null,
    image: match?.variant?.images[0] ?? match?.product.images[0] ?? null,
    ...orderAmounts(match, sellTotal, line.quantity, line.currency),
    buyCurrency: "AUD", sellTotal, currency: line.currency,
    buyItemId: match?.product.asin ?? null, ebayItemId: line.ebayItemId,
    status: line.status, estimatedArrival: line.estimatedArrival, matched: Boolean(match),
  };
}

export function parseOrderEdit(body: unknown): { status?: OrderStatus; estimatedArrival?: string | null } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid order update");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "status" && key !== "estimatedArrival")) {
    throw new Error("Only order status and estimated arrival can be edited");
  }
  const result: { status?: OrderStatus; estimatedArrival?: string | null } = {};
  if (Object.hasOwn(input, "status")) {
    if (!(ORDER_STATUSES as readonly unknown[]).includes(input.status)) throw new Error("Invalid order status");
    result.status = input.status as OrderStatus;
  }
  if (Object.hasOwn(input, "estimatedArrival")) {
    const value = input.estimatedArrival;
    if (value !== null) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          value.startsWith("0000") || !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
          new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) {
        throw new Error("Estimated arrival must be a valid calendar date");
      }
    }
    result.estimatedArrival = value;
  }
  if (Object.keys(result).length === 0) throw new Error("No editable fields supplied");
  return result;
}

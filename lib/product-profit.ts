import { calculateNetProfit } from "@/lib/variant-pricing";

type MoneyValue = number | string | { toString(): string } | null | undefined;

export type ProductProfitVariant = {
  buyPrice: MoneyValue;
  sellPrice: MoneyValue;
  feesPercent?: number | null;
  feesFixed?: number | null;
};

export type ProductProfitInput = {
  price: MoneyValue;
  amazonPrice?: MoneyValue;
  promotedAdStatus?: string | null;
  promotedAdPercent?: number | null;
  promotedAdRateStrategy?: string | null;
  variants?: ProductProfitVariant[] | null;
};

export type ProductProfitCandidate = ProductProfitInput & {
  id: string;
};

function parseMoney(value: MoneyValue) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function isInRange(value: number, min: number | null, max: number | null) {
  return (min === null || value >= min) && (max === null || value <= max);
}

function getSyncedPromotedAdPercent(product: ProductProfitInput) {
  if (product.promotedAdStatus === "NOT_PROMOTED") {
    return 0;
  }

  if (
    product.promotedAdStatus !== "PROMOTED" ||
    product.promotedAdRateStrategy === "DYNAMIC" ||
    typeof product.promotedAdPercent !== "number" ||
    !Number.isFinite(product.promotedAdPercent)
  ) {
    return null;
  }

  return Math.max(0, product.promotedAdPercent);
}

export type ProductDisplayProfit = {
  profit: number;
  profitAfterAdFee: number | null;
};

export function getProductDisplayProfitBreakdown(product: ProductProfitInput) {
  const promotedAdPercent = getSyncedPromotedAdPercent(product);
  const variantProfits = (product.variants ?? [])
    .map((variant) => {
      const buyPrice = parseMoney(variant.buyPrice);
      const sellPrice = parseMoney(variant.sellPrice);

      if (buyPrice === null || sellPrice === null) {
        return null;
      }

      const profit = calculateNetProfit({
        buyPrice,
        sellPrice,
        feesPercent: variant.feesPercent ?? 0,
        feesFixed: variant.feesFixed ?? 0,
      });

      return {
        profit,
        profitAfterAdFee:
          promotedAdPercent === null
            ? null
            : calculateNetProfit({
                buyPrice,
                sellPrice,
                feesPercent: variant.feesPercent ?? 0,
                feesFixed: variant.feesFixed ?? 0,
                promotedAdPercent,
              }),
      } satisfies ProductDisplayProfit;
    })
    .filter((value): value is ProductDisplayProfit => value !== null);

  if (variantProfits.length > 0) {
    return variantProfits;
  }

  const fallbackBuyPrice = parseMoney(product.amazonPrice);
  const fallbackSellPrice = parseMoney(product.price);

  if (fallbackBuyPrice === null || fallbackSellPrice === null) {
    return [];
  }

  const profit = calculateNetProfit({
    buyPrice: fallbackBuyPrice,
    sellPrice: fallbackSellPrice,
    feesPercent: 0,
    feesFixed: 0,
  });

  return [
    {
      profit,
      profitAfterAdFee:
        promotedAdPercent === null
          ? null
          : calculateNetProfit({
              buyPrice: fallbackBuyPrice,
              sellPrice: fallbackSellPrice,
              feesPercent: 0,
              feesFixed: 0,
              promotedAdPercent,
            }),
    },
  ];
}

export function getProductDisplayProfits(product: ProductProfitInput) {
  return getProductDisplayProfitBreakdown(product).map(
    (breakdown) => breakdown.profit,
  );
}

export function productMatchesDisplayProfitRange(
  product: ProductProfitInput,
  min: number | null,
  max: number | null
) {
  if (min === null && max === null) {
    return true;
  }

  return getProductDisplayProfits(product).some((profit) =>
    isInRange(profit, min, max)
  );
}

export function getProductIdsMatchingDisplayProfitRange(
  products: ProductProfitCandidate[],
  min: number | null,
  max: number | null
) {
  return products
    .filter((product) => productMatchesDisplayProfitRange(product, min, max))
    .map((product) => product.id);
}

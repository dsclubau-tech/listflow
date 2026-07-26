import {
  calculateNetProfit,
  calculatePromotedAdFee,
} from "@/lib/variant-pricing";

type MoneyValue = number | string | { toString(): string } | null | undefined;

export type PromotedListingProfitVariant = {
  id?: string;
  title?: string;
  buyPrice: MoneyValue;
  sellPrice: MoneyValue;
  feesPercent?: number | null;
  feesFixed?: number | null;
};

export type PromotedListingProfitProduct = {
  id: string;
  title: string;
  price: MoneyValue;
  amazonPrice?: MoneyValue;
  variants?: PromotedListingProfitVariant[] | null;
};

export type PromotedListingProfitRow = {
  productId: string;
  productTitle: string;
  variantId: string | null;
  variantTitle: string | null;
  buyPrice: number;
  sellPrice: number;
  profitBeforeAdFee: number;
  potentialAdFee: number;
  profitAfterAdFee: number;
};

export type PromotedListingProfitPreview = {
  rate: number;
  rows: PromotedListingProfitRow[];
  pricedProductCount: number;
  unpricedProductCount: number;
  profitBeforeAdFee: number;
  potentialAdFee: number;
  profitAfterAdFee: number;
};

function parseMoney(value: MoneyValue) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function createPreviewRow(input: {
  product: PromotedListingProfitProduct;
  variant?: PromotedListingProfitVariant;
  rate: number;
}) {
  const buyPrice = parseMoney(
    input.variant ? input.variant.buyPrice : input.product.amazonPrice,
  );
  const sellPrice = parseMoney(
    input.variant ? input.variant.sellPrice : input.product.price,
  );

  if (buyPrice === null || sellPrice === null) {
    return null;
  }

  const feesPercent = input.variant?.feesPercent ?? 0;
  const feesFixed = input.variant?.feesFixed ?? 0;
  const profitBeforeAdFee = calculateNetProfit({
    buyPrice,
    sellPrice,
    feesPercent,
    feesFixed,
  });
  const potentialAdFee = calculatePromotedAdFee({
    sellPrice,
    promotedAdPercent: input.rate,
  });
  const profitAfterAdFee = calculateNetProfit({
    buyPrice,
    sellPrice,
    feesPercent,
    feesFixed,
    promotedAdPercent: input.rate,
  });

  return {
    productId: input.product.id,
    productTitle: input.product.title,
    variantId: input.variant?.id ?? null,
    variantTitle: input.variant?.title ?? null,
    buyPrice,
    sellPrice,
    profitBeforeAdFee,
    potentialAdFee,
    profitAfterAdFee,
  } satisfies PromotedListingProfitRow;
}

export function getPromotedListingProfitPreview(
  products: PromotedListingProfitProduct[],
  rate: number,
): PromotedListingProfitPreview {
  const normalizedRate = Math.max(0, Number.isFinite(rate) ? rate : 0);
  const rows: PromotedListingProfitRow[] = [];
  const pricedProductIds = new Set<string>();

  for (const product of products) {
    const variants = product.variants ?? [];
    const productRows =
      variants.length > 0
        ? variants
            .map((variant) =>
              createPreviewRow({ product, variant, rate: normalizedRate }),
            )
            .filter((row): row is PromotedListingProfitRow => row !== null)
        : [
            createPreviewRow({ product, rate: normalizedRate }),
          ].filter((row): row is PromotedListingProfitRow => row !== null);

    for (const row of productRows) {
      rows.push(row);
      pricedProductIds.add(product.id);
    }
  }

  return {
    rate: normalizedRate,
    rows,
    pricedProductCount: pricedProductIds.size,
    unpricedProductCount: Math.max(0, products.length - pricedProductIds.size),
    profitBeforeAdFee: roundMoney(
      rows.reduce((total, row) => total + row.profitBeforeAdFee, 0),
    ),
    potentialAdFee: roundMoney(
      rows.reduce((total, row) => total + row.potentialAdFee, 0),
    ),
    profitAfterAdFee: roundMoney(
      rows.reduce((total, row) => total + row.profitAfterAdFee, 0),
    ),
  };
}

import { Prisma, type Product, type Variant } from "@/app/generated/prisma/client";
import { dedupeProductImages } from "@/lib/product-images";
import { prisma } from "@/lib/prisma";
import { getAutomaticSku } from "@/lib/sku";
import { calculateSellPrice } from "@/lib/variant-pricing";
import type { VariantPayload, VariantRecord } from "@/types/variant";
import { variantStatuses } from "@/types/variant";

type DefaultVariantSource = {
  id: string;
  price: Product["price"] | number | string;
  quantity: number;
  images: string[];
  asin?: string | null;
  automaticSkuFilling?: boolean | null;
  feesPercent?: number | null;
  feesFixed?: number | null;
  profitPercent?: number | null;
  profitFixed?: number | null;
  minimumProfit?: number | null;
};

type VariantSource = Variant & {
  itemSpecifics: unknown;
};

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function toNullableString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeImages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeProductImages(value);
}

function normalizeItemSpecifics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string"
    )
  );
}

export function serializeVariant(variant: VariantSource): VariantRecord {
  return {
    id: variant.id,
    sku: variant.sku,
    title: variant.title,
    images: dedupeProductImages(variant.images),
    buyPrice: variant.buyPrice.toString(),
    feesPercent: variant.feesPercent,
    feesFixed: variant.feesFixed,
    profitPercent: variant.profitPercent,
    profitFixed: variant.profitFixed,
    promotedAdPercent: variant.promotedAdPercent,
    sellPrice: variant.sellPrice.toString(),
    quantity: variant.quantity,
    status: variant.status,
    automation: variant.automation,
    includeShipping: variant.includeShipping,
    allowMarketplace: variant.allowMarketplace,
    roundCents: variant.roundCents,
    itemSpecifics: normalizeItemSpecifics(variant.itemSpecifics),
    productId: variant.productId,
    createdAt: variant.createdAt.toISOString(),
    updatedAt: variant.updatedAt.toISOString(),
  };
}

export function normalizeVariantPayload(body: unknown): VariantPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid variant payload");
  }

  const source = body as Record<string, unknown>;
  const title = typeof source.title === "string" ? source.title.trim() : "";

  if (!title) {
    throw new Error("Variant title is required");
  }

  const status = typeof source.status === "string" ? source.status : "IN_STOCK";

  if (!variantStatuses.includes(status as (typeof variantStatuses)[number])) {
    throw new Error("Variant status is invalid");
  }

  const quantity = Math.max(0, Math.floor(toNumber(source.quantity, 1)));
  const buyPrice = Math.max(0, toNumber(source.buyPrice, 0));
  const sellPrice = Math.max(0, toNumber(source.sellPrice, 0));

  return {
    sku: toNullableString(source.sku),
    title,
    images: normalizeImages(source.images),
    buyPrice,
    feesPercent: Math.max(0, toNumber(source.feesPercent, 0)),
    feesFixed: Math.max(0, toNumber(source.feesFixed, 0)),
    profitPercent: Math.max(0, toNumber(source.profitPercent, 0)),
    profitFixed: toNumber(source.profitFixed, 0),
    promotedAdPercent: Math.min(
      100,
      Math.max(0, toNumber(source.promotedAdPercent, 0))
    ),
    sellPrice,
    quantity,
    status: status as VariantPayload["status"],
    automation: toNullableString(source.automation),
    includeShipping: toBoolean(source.includeShipping, true),
    allowMarketplace: toBoolean(source.allowMarketplace, true),
    roundCents:
      source.roundCents === null || source.roundCents === undefined
        ? null
        : toNumber(source.roundCents, 0),
    itemSpecifics: normalizeItemSpecifics(source.itemSpecifics),
  };
}

export function buildDefaultVariantData(product: DefaultVariantSource) {
  const status = product.quantity > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
  const feesPercent = Math.max(0, toNumber(product.feesPercent, 0));
  const feesFixed = Math.max(0, toNumber(product.feesFixed, 0));
  const profitPercent = Math.max(0, toNumber(product.profitPercent, 0));
  const profitFixed = toNumber(product.profitFixed, 0);
  const minimumProfit = Math.max(0, toNumber(product.minimumProfit, 0));
  const buyPriceNumber = toNumber(product.price, 0);
  const sellPrice = calculateSellPrice({
    buyPrice: buyPriceNumber,
    feesPercent,
    feesFixed,
    profitPercent,
    profitFixed,
    minimumProfit,
    roundCents: null,
  });

  return {
    sku: getAutomaticSku({
      asin: product.asin,
      automaticSkuFilling: product.automaticSkuFilling,
    }),
    title: "Default",
    images: dedupeProductImages(product.images),
    buyPrice: product.price,
    feesPercent,
    feesFixed,
    profitPercent,
    profitFixed,
    promotedAdPercent: 0,
    sellPrice,
    quantity: product.quantity,
    status: status as VariantPayload["status"],
    automation: null,
    includeShipping: true,
    allowMarketplace: true,
    roundCents: null,
    itemSpecifics: {},
    productId: product.id,
  };
}

function isSerializationFailure(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export async function ensureDefaultVariantForProduct(productId: string) {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE
          `;

          const existingCount = await tx.variant.count({
            where: { productId },
          });

          if (existingCount > 0) {
            return;
          }

          const product = await tx.product.findUnique({
            where: { id: productId },
            select: {
              id: true,
              price: true,
              quantity: true,
              images: true,
              asin: true,
              storeId: true,
            },
          });

          if (!product) {
            return;
          }

          const supplierSettings =
            (await tx.supplierSettings.findUnique({
              where: {
                storeId_supplierName: {
                  storeId: product.storeId,
                  supplierName: "Amazon AU",
                },
              },
              select: {
                automaticSkuFilling: true,
                ebayFeePercent: true,
                fixedFeeAmount: true,
                additionalProfitPercent: true,
                additionalProfitFixed: true,
                minimumProfit: true,
              },
            })) ??
            (await tx.supplierSettings.findFirst({
              where: {
                storeId: null,
                supplierName: "Amazon AU",
              },
              select: {
                automaticSkuFilling: true,
                ebayFeePercent: true,
                fixedFeeAmount: true,
                additionalProfitPercent: true,
                additionalProfitFixed: true,
                minimumProfit: true,
              },
            }));

          await tx.variant.create({
            data: buildDefaultVariantData({
              ...product,
              automaticSkuFilling:
                supplierSettings?.automaticSkuFilling ?? true,
              feesPercent: supplierSettings?.ebayFeePercent ?? 13,
              feesFixed: supplierSettings?.fixedFeeAmount ?? 0.33,
              profitPercent: supplierSettings?.additionalProfitPercent ?? 0,
              profitFixed: supplierSettings?.additionalProfitFixed ?? 0,
              minimumProfit: supplierSettings?.minimumProfit ?? 1,
            }),
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isSerializationFailure(error)) {
        throw error;
      }
    }
  }
}

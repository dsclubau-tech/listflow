import { chromium } from "playwright";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { scrapeAmazonPrice } from "@/lib/amazon-scraper";
import { calculateSellPrice } from "@/lib/variant-pricing";
import { buildReviseItemXML } from "@/lib/ebay-xml";
import { callEbayReviseItem, getStoreNumber } from "@/lib/ebay";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { logger } from "@/lib/logger";

const PRICE_TOLERANCE = 0.01;
const PRODUCT_DELAY_MS = 3000;
const SUPPLIER_NAME = "Amazon AU";

export interface PriceCheckResult {
  checked: number;
  changed: number;
  failed: number;
  skipped: number;
  reason?: string;
}

interface RunPriceCheckOptions {
  productIds?: string[];
  ignoreSchedule?: boolean;
}

type ProductRecord = NonNullable<Awaited<ReturnType<typeof prisma.product.findFirst>>>;
type StoreRecord = NonNullable<Awaited<ReturnType<typeof prisma.store.findFirst>>>;
type RevisableProduct = ProductRecord & { store: StoreRecord };

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function toMoneyDecimal(value: number) {
  return new Prisma.Decimal(roundMoney(value).toFixed(2));
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(numeric) ? numeric : null;
}

function hasMoneyChanged(previous: number, next: number) {
  return Math.abs(previous - next) > PRICE_TOLERANCE;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSupplierSettings() {
  return prisma.supplierSettings.upsert({
    where: { supplierName: SUPPLIER_NAME },
    update: {},
    create: { supplierName: SUPPLIER_NAME },
  });
}

async function reviseProductPrice(product: RevisableProduct) {
  if (!product.ebayItemId) {
    throw new Error("Product is missing an eBay item ID.");
  }

  const storeNumber = await getStoreNumber(product.storeId);
  const finalDescription = await resolveDescriptionTemplate(product);
  const xml = buildReviseItemXML({
    ...product,
    description: finalDescription,
  });

  return callEbayReviseItem(xml, storeNumber);
}

export async function runPriceCheck(
  options: RunPriceCheckOptions = {}
): Promise<PriceCheckResult> {
  const supplierSettings = await getSupplierSettings();

  if (!options.ignoreSchedule && !supplierSettings.priceTrackingEnabled) {
    return {
      checked: 0,
      changed: 0,
      failed: 0,
      skipped: 0,
      reason: "Price tracking is disabled.",
    };
  }

  if (!options.ignoreSchedule) {
    const currentUtcHour = new Date().getUTCHours();

    if (currentUtcHour !== supplierSettings.priceCheckHour) {
      return {
        checked: 0,
        changed: 0,
        failed: 0,
        skipped: 0,
        reason: `Current UTC hour ${currentUtcHour} does not match configured hour ${supplierSettings.priceCheckHour}.`,
      };
    }
  }

  const normalizedIds =
    options.productIds?.map((id) => id.trim()).filter(Boolean) ?? [];
  const restrictToIds = normalizedIds.length > 0;

  const products = await prisma.product.findMany({
    where: {
      status: "IMPORTED",
      ...(restrictToIds ? { id: { in: normalizedIds } } : {}),
    },
    include: {
      store: true,
      variants: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (products.length === 0) {
    return { checked: 0, changed: 0, failed: 0, skipped: 0 };
  }

  const browser = await chromium.launch({ headless: true });
  const result: PriceCheckResult = {
    checked: 0,
    changed: 0,
    failed: 0,
    skipped: 0,
  };

  try {
    for (const product of products) {
      result.checked += 1;

      if (!product.asin || product.variants.length === 0) {
        result.skipped += 1;
        continue;
      }

      const checkedAt = new Date();

      try {
        const currentAmazonPrice = await scrapeAmazonPrice(product.asin, browser);

        if (currentAmazonPrice === null) {
          result.failed += 1;

          await prisma.product.update({
            where: { id: product.id },
            data: {
              lastPriceCheck: checkedAt,
              priceCheckError: "Current Amazon price is unavailable.",
            },
          });

          logger.warn("price-checker/run", "Amazon price unavailable", {
            productId: product.id,
            asin: product.asin,
          });

          continue;
        }

        const previousAmazonPrice =
          decimalToNumber(product.amazonPrice) ??
          decimalToNumber(product.variants[0]?.buyPrice);

        if (!previousAmazonPrice || previousAmazonPrice <= 0) {
          result.failed += 1;

          await prisma.product.update({
            where: { id: product.id },
            data: {
              lastPriceCheck: checkedAt,
              priceCheckError: "Tracked product has no baseline Amazon buy price.",
            },
          });

          logger.warn("price-checker/run", "Missing baseline Amazon price", {
            productId: product.id,
            asin: product.asin,
          });

          continue;
        }

        if (!hasMoneyChanged(previousAmazonPrice, currentAmazonPrice)) {
          result.skipped += 1;

          await prisma.product.update({
            where: { id: product.id },
            data: {
              amazonPrice: toMoneyDecimal(currentAmazonPrice),
              lastPriceCheck: checkedAt,
              priceCheckError: null,
            },
          });

          continue;
        }

        const changeRatio = currentAmazonPrice / previousAmazonPrice;
        const changePercent =
          ((currentAmazonPrice - previousAmazonPrice) / previousAmazonPrice) * 100;
        const nextVariants = product.variants.map((variant) => {
          const previousBuyPrice = decimalToNumber(variant.buyPrice) ?? 0;
          const previousSellPrice = decimalToNumber(variant.sellPrice) ?? 0;
          const nextBuyPrice = roundMoney(previousBuyPrice * changeRatio);
          const nextSellPrice = calculateSellPrice({
            buyPrice: nextBuyPrice,
            feesPercent: variant.feesPercent,
            feesFixed: variant.feesFixed,
            profitPercent: variant.profitPercent,
            profitFixed: variant.profitFixed,
            roundCents: variant.roundCents,
          });

          return {
            id: variant.id,
            previousBuyPrice,
            nextBuyPrice,
            previousSellPrice,
            nextSellPrice,
          };
        });

        const nextPrimarySellPrice = nextVariants[0]?.nextSellPrice;

        if (nextPrimarySellPrice === undefined) {
          result.skipped += 1;
          continue;
        }

        const reviseResult = await reviseProductPrice({
          ...product,
          price: toMoneyDecimal(nextPrimarySellPrice),
        });

        if (!reviseResult.success) {
          result.failed += 1;

          await prisma.$transaction(async (tx) => {
            await tx.product.update({
              where: { id: product.id },
              data: {
                lastPriceCheck: checkedAt,
                priceCheckError:
                  reviseResult.errorMessage || "Failed to revise eBay listing.",
              },
            });

            await tx.priceHistory.createMany({
              data: nextVariants.map((variant) => ({
                productId: product.id,
                variantId: variant.id,
                previousPrice: toMoneyDecimal(variant.previousBuyPrice),
                newPrice: toMoneyDecimal(variant.nextBuyPrice),
                previousSellPrice: toMoneyDecimal(variant.previousSellPrice),
                newSellPrice: toMoneyDecimal(variant.nextSellPrice),
                changePercent,
                ebayRevised: false,
                errorMessage:
                  reviseResult.errorMessage || "Failed to revise eBay listing.",
                createdAt: checkedAt,
              })),
            });
          });

          logger.error(
            "price-checker/run",
            "eBay revise failed for tracked product",
            undefined,
            {
              productId: product.id,
              ebayItemId: product.ebayItemId,
              errorMessage: reviseResult.errorMessage,
            }
          );

          continue;
        }

        await prisma.$transaction(async (tx) => {
          await Promise.all(
            nextVariants.map((variant) =>
              tx.variant.update({
                where: { id: variant.id },
                data: {
                  buyPrice: toMoneyDecimal(variant.nextBuyPrice),
                  sellPrice: toMoneyDecimal(variant.nextSellPrice),
                },
              })
            )
          );

          await tx.product.update({
            where: { id: product.id },
            data: {
              price: toMoneyDecimal(nextPrimarySellPrice),
              amazonPrice: toMoneyDecimal(currentAmazonPrice),
              lastPriceCheck: checkedAt,
              priceCheckError: null,
            },
          });

          await tx.priceHistory.createMany({
            data: nextVariants.map((variant) => ({
              productId: product.id,
              variantId: variant.id,
              previousPrice: toMoneyDecimal(variant.previousBuyPrice),
              newPrice: toMoneyDecimal(variant.nextBuyPrice),
              previousSellPrice: toMoneyDecimal(variant.previousSellPrice),
              newSellPrice: toMoneyDecimal(variant.nextSellPrice),
              changePercent,
              ebayRevised: true,
              errorMessage: null,
              createdAt: checkedAt,
            })),
          });
        });

        result.changed += 1;

        logger.info("price-checker/run", "Tracked product price updated", {
          productId: product.id,
          asin: product.asin,
          previousAmazonPrice,
          currentAmazonPrice,
          changePercent: roundMoney(changePercent),
        });
      } catch (error) {
        result.failed += 1;

        const message =
          error instanceof Error ? error.message : "Unexpected price check error";

        await prisma.product.update({
          where: { id: product.id },
          data: {
            lastPriceCheck: checkedAt,
            priceCheckError: message,
          },
        });

        logger.error("price-checker/run", "Price check failed", error, {
          productId: product.id,
          asin: product.asin,
        });
      }

      await sleep(PRODUCT_DELAY_MS);
    }

    return result;
  } finally {
    await browser.close();
  }
}

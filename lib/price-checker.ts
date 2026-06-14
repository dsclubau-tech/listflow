import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { scrapeAmazonPrice } from "@/lib/amazon-scraper";
import { calculateSellPrice } from "@/lib/variant-pricing";
import { buildReviseItemXML } from "@/lib/ebay-xml";
import { callEbayReviseItem, getStoreNumber } from "@/lib/ebay";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { logger } from "@/lib/logger";

const PRICE_TOLERANCE = 0.01;
const PRODUCT_DELAY_MIN_MS = 3000;
const PRODUCT_DELAY_MAX_MS = 7000;
const SUPPLIER_NAME = "Amazon AU";

/** Guard 1: reject price changes larger than this percentage in either direction. */
const MAX_CHANGE_PERCENT = 80;

export interface PriceCheckResult {
  checked: number;
  changed: number;
  pendingReview: number;
  failed: number;
  skipped: number;
  reason?: string;
}

export type PriceCheckProgress = PriceCheckResult & { total: number };

interface RunPriceCheckOptions {
  productIds?: string[];
  ignoreSchedule?: boolean;
  simulatedPrices?: Record<string, number>;
  onProgress?: (progress: PriceCheckProgress) => void | Promise<void>;
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

function getProductDelayMs() {
  return (
    PRODUCT_DELAY_MIN_MS +
    Math.random() * (PRODUCT_DELAY_MAX_MS - PRODUCT_DELAY_MIN_MS)
  );
}

async function getSupplierSettings() {
  return prisma.supplierSettings.upsert({
    where: { supplierName: SUPPLIER_NAME },
    update: {},
    create: { supplierName: SUPPLIER_NAME },
  });
}

export async function reviseProductPrice(
  product: RevisableProduct,
  overrideStartPrice?: number,
) {
  if (!product.ebayItemId) {
    throw new Error("Product is missing an eBay item ID.");
  }

  const storeNumber = await getStoreNumber(product.storeId);
  const finalDescription = await resolveDescriptionTemplate(product);
  const xml = buildReviseItemXML(
    {
      ...product,
      description: finalDescription,
    },
    overrideStartPrice,
  );

  return callEbayReviseItem(xml, storeNumber);
}

function getSimulatedPrice(
  simulatedPrices: Record<string, number> | undefined,
  productId: string
) {
  if (!simulatedPrices) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(simulatedPrices, productId)) {
    return null;
  }

  const value = simulatedPrices[productId];
  return Number.isFinite(value) ? roundMoney(value) : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected price check error";
}

function getAmazonStockUpdate(stockLeft: number | null | undefined) {
  return stockLeft === undefined ? {} : { amazonStockLeft: stockLeft };
}

export async function runPriceCheck(
  options: RunPriceCheckOptions = {}
): Promise<PriceCheckResult> {
  const supplierSettings = await getSupplierSettings();

  if (!options.ignoreSchedule && !supplierSettings.priceTrackingEnabled) {
    return {
      checked: 0,
      changed: 0,
      pendingReview: 0,
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
        pendingReview: 0,
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
    return { checked: 0, changed: 0, pendingReview: 0, failed: 0, skipped: 0 };
  }

  const result: PriceCheckResult = {
    checked: 0,
    changed: 0,
    pendingReview: 0,
    failed: 0,
    skipped: 0,
  };
  const reportProgress = async () => {
    if (!options.onProgress) {
      return;
    }

    try {
      await options.onProgress({ ...result, total: products.length });
    } catch (error) {
      logger.warn("price-checker/run", "Price check progress callback failed", {
        errorMessage: getErrorMessage(error),
      });
    }
  };

  await reportProgress();

  const scrapeAmazonPriceWithRetry = async (productId: string, asin: string) => {
    const scrapeWithOwnedBrowser = () =>
      scrapeAmazonPrice(
        asin,
        undefined,
        supplierSettings.scrapePostcode || undefined
      );

    try {
      return await scrapeWithOwnedBrowser();
    } catch (error) {
      logger.warn(
        "price-checker/run",
        "Amazon scrape failed; retrying with a fresh browser",
        {
          productId,
          asin,
          errorMessage: getErrorMessage(error),
        }
      );

      try {
        return await scrapeWithOwnedBrowser();
      } catch (retryError) {
        logger.warn("price-checker/run", "Amazon scrape retry failed", {
          productId,
          asin,
          errorMessage: getErrorMessage(retryError),
        });

        throw retryError;
      }
    }
  };

  for (const [index, product] of products.entries()) {
    result.checked += 1;

      if (!product.asin || product.variants.length === 0) {
        result.skipped += 1;
        await reportProgress();
        continue;
      }

      const checkedAt = new Date();
      const simulatedAmazonPrice = getSimulatedPrice(
        options.simulatedPrices,
        product.id
      );
      const priceHistorySource =
        simulatedAmazonPrice !== null ? "SIMULATED" : "LIVE";

      try {
        let currentAmazonPrice: number | null;
        let scrapedAmazonStockLeft: number | null | undefined;

        if (simulatedAmazonPrice !== null) {
          currentAmazonPrice = simulatedAmazonPrice;
        } else {
          const scrapeResult = await scrapeAmazonPriceWithRetry(
            product.id,
            product.asin
          );
          currentAmazonPrice = scrapeResult.price;
          scrapedAmazonStockLeft = scrapeResult.stockLeft;
        }

        const amazonStockUpdate = getAmazonStockUpdate(scrapedAmazonStockLeft);

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

          await reportProgress();
          continue;
        }

        const previousAmazonPrice =
          decimalToNumber(product.amazonPrice) ??
          decimalToNumber(product.variants[0]?.buyPrice);

        // First-time check: record the Amazon baseline and correct the
        // primary BUY price without revising the eBay listing.
        const isFirstCheck = product.amazonPrice === null;

        if (isFirstCheck) {
          result.skipped += 1;

          const primaryVariant = product.variants[0];
          const currentAmazonPriceDecimal = toMoneyDecimal(currentAmazonPrice);

          await prisma.$transaction(async (tx) => {
            await tx.product.update({
              where: { id: product.id },
              data: {
                amazonPrice: currentAmazonPriceDecimal,
                ...amazonStockUpdate,
                lastPriceCheck: checkedAt,
                priceCheckError: null,
              },
            });

            await tx.variant.update({
              where: { id: primaryVariant.id },
              data: {
                buyPrice: currentAmazonPriceDecimal,
              },
            });
          });

          logger.info("price-checker/run", "First check — baseline established", {
            productId: product.id,
            asin: product.asin,
            baselinePrice: currentAmazonPrice,
          });

          await reportProgress();
          continue;
        }

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

          await reportProgress();
          continue;
        }

        if (!hasMoneyChanged(previousAmazonPrice, currentAmazonPrice)) {
          // Amazon price hasn't changed, but check if the primary variant's
          // buyPrice is out of sync with the Amazon price. This happens when
          // the variant was imported with buyPrice = sellPrice (markup baked
          // in) or when the user updates fee/profit settings without fixing
          // the buyPrice.
          const primaryVariant = product.variants[0];
          const primaryBuyPrice = primaryVariant
            ? (decimalToNumber(primaryVariant.buyPrice) ?? 0)
            : 0;

          const buyPriceMismatch =
            primaryVariant &&
            hasMoneyChanged(primaryBuyPrice, currentAmazonPrice);

          if (!buyPriceMismatch) {
            result.skipped += 1;

            await prisma.product.update({
              where: { id: product.id },
              data: {
                amazonPrice: toMoneyDecimal(currentAmazonPrice),
                ...amazonStockUpdate,
                lastPriceCheck: checkedAt,
                priceCheckError: null,
              },
            });

            await reportProgress();
            continue;
          }

          // buyPrice ≠ amazonPrice — create a pending review to correct it.
          logger.info("price-checker/run", "Variant buyPrice mismatch detected", {
            productId: product.id,
            asin: product.asin,
            primaryBuyPrice,
            amazonPrice: currentAmazonPrice,
          });

          const mismatchVariants = product.variants.map((variant, idx) => {
            const prevBuy = decimalToNumber(variant.buyPrice) ?? 0;
            const prevSell = decimalToNumber(variant.sellPrice) ?? 0;
            const nextBuy = idx === 0
              ? roundMoney(currentAmazonPrice)
              : prevBuy;

            const hasFeeOrProfit =
              variant.feesPercent > 0 ||
              variant.feesFixed > 0 ||
              variant.profitPercent > 0 ||
              variant.profitFixed > 0;

            let nextSell: number;
            if (hasFeeOrProfit) {
              nextSell = calculateSellPrice({
                buyPrice: nextBuy,
                feesPercent: variant.feesPercent,
                feesFixed: variant.feesFixed,
                profitPercent: variant.profitPercent,
                profitFixed: variant.profitFixed,
                roundCents: variant.roundCents,
              });
            } else {
              // Preserve dollar margin when no fees configured
              const margin = prevSell - (previousAmazonPrice ?? prevBuy);
              nextSell = roundMoney(Math.max(nextBuy, nextBuy + margin));
            }

            return {
              id: variant.id,
              previousBuyPrice: prevBuy,
              nextBuyPrice: nextBuy,
              previousSellPrice: prevSell,
              nextSellPrice: nextSell,
            };
          });

          const mismatchChangePercent =
            ((currentAmazonPrice - primaryBuyPrice) / primaryBuyPrice) * 100;

          await prisma.$transaction(async (tx) => {
            await tx.priceHistory.updateMany({
              where: {
                productId: product.id,
                appliedAt: null,
              },
              data: {
                appliedAt: checkedAt,
                ebayRevised: false,
                errorMessage: null,
              },
            });

            await tx.product.update({
              where: { id: product.id },
              data: {
                amazonPrice: toMoneyDecimal(currentAmazonPrice),
                ...amazonStockUpdate,
                lastPriceCheck: checkedAt,
                priceCheckError: null,
              },
            });

            await tx.priceHistory.createMany({
              data: mismatchVariants.map((variant) => ({
                productId: product.id,
                variantId: variant.id,
                previousPrice: toMoneyDecimal(variant.previousBuyPrice),
                newPrice: toMoneyDecimal(variant.nextBuyPrice),
                previousSellPrice: toMoneyDecimal(variant.previousSellPrice),
                newSellPrice: toMoneyDecimal(variant.nextSellPrice),
                changePercent: roundMoney(mismatchChangePercent),
                ebayRevised: false,
                errorMessage: null,
                source: priceHistorySource,
                appliedAt: null,
                createdAt: checkedAt,
              })),
            });
          });

          result.changed += 1;
          result.pendingReview += 1;

          logger.info("price-checker/run", "BuyPrice correction recorded for review", {
            productId: product.id,
            asin: product.asin,
            oldBuyPrice: primaryBuyPrice,
            newBuyPrice: currentAmazonPrice,
            newSellPrice: mismatchVariants[0]?.nextSellPrice,
          });

          await reportProgress();
          continue;
        }

        const changeRatio = currentAmazonPrice / previousAmazonPrice;
        const changePercent =
          ((currentAmazonPrice - previousAmazonPrice) / previousAmazonPrice) * 100;

        // --- Guard 1: Reject implausible price swings ---
        // If the Amazon price supposedly changed by more than MAX_CHANGE_PERCENT
        // in either direction, stop and flag it. A $999 product doesn't drop
        // to $5 overnight through normal market movement.
        if (Math.abs(changePercent) > MAX_CHANGE_PERCENT) {
          result.failed += 1;

          await prisma.product.update({
            where: { id: product.id },
            data: {
              lastPriceCheck: checkedAt,
              priceCheckError:
                `Price change of ${changePercent.toFixed(1)}% exceeds the ` +
                `${MAX_CHANGE_PERCENT}% safety limit. Amazon price went from ` +
                `A$${previousAmazonPrice.toFixed(2)} to A$${currentAmazonPrice.toFixed(2)}. ` +
                `Manual review required.`,
            },
          });

          logger.warn("price-checker/run", "Guard 1: price change exceeds threshold", {
            productId: product.id,
            asin: product.asin,
            previousAmazonPrice,
            currentAmazonPrice,
            changePercent: roundMoney(changePercent),
            threshold: MAX_CHANGE_PERCENT,
          });

          await reportProgress();
          continue;
        }
        const nextVariants = product.variants.map((variant, variantIndex) => {
          const previousBuyPrice = decimalToNumber(variant.buyPrice) ?? 0;
          const previousSellPrice = decimalToNumber(variant.sellPrice) ?? 0;

          // For the primary variant (index 0), set buyPrice directly to the
          // current Amazon price. For additional variants, scale proportionally
          // using the change ratio so they maintain their relative pricing.
          const nextBuyPrice =
            variantIndex === 0
              ? roundMoney(currentAmazonPrice)
              : roundMoney(previousBuyPrice * changeRatio);

          const hasFeeOrProfit =
            variant.feesPercent > 0 ||
            variant.feesFixed > 0 ||
            variant.profitPercent > 0 ||
            variant.profitFixed > 0;

          let nextSellPrice: number;

          if (hasFeeOrProfit) {
            // Normal path: recalculate sell price from the new buy price using
            // the variant's fee/profit settings.
            nextSellPrice = calculateSellPrice({
              buyPrice: nextBuyPrice,
              feesPercent: variant.feesPercent,
              feesFixed: variant.feesFixed,
              profitPercent: variant.profitPercent,
              profitFixed: variant.profitFixed,
              roundCents: variant.roundCents,
            });
          } else {
            // Fallback for variants where the markup was baked into buyPrice
            // (fees and profit are all zero). Preserve the dollar margin
            // between the old Amazon price and the old sell price so the user
            // doesn't lose their entire markup.
            const dollarMargin = previousSellPrice - (previousAmazonPrice ?? previousBuyPrice);
            nextSellPrice = roundMoney(Math.max(nextBuyPrice, nextBuyPrice + dollarMargin));
          }

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
          await reportProgress();
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.priceHistory.updateMany({
            where: {
              productId: product.id,
              appliedAt: null,
            },
            data: {
              appliedAt: checkedAt,
              ebayRevised: false,
              errorMessage: null,
            },
          });

          await tx.product.update({
            where: { id: product.id },
            data: {
              amazonPrice: toMoneyDecimal(currentAmazonPrice),
              ...amazonStockUpdate,
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
              ebayRevised: false,
              errorMessage: null,
              source: priceHistorySource,
              appliedAt: null,
              createdAt: checkedAt,
            })),
          });
        });

        result.changed += 1;
        result.pendingReview += 1;

        logger.info("price-checker/run", "Tracked product price change recorded for review", {
          productId: product.id,
          asin: product.asin,
          previousAmazonPrice,
          currentAmazonPrice,
          changePercent: roundMoney(changePercent),
          usedSimulatedPrice: simulatedAmazonPrice !== null,
        });
      } catch (error) {
        result.failed += 1;

        const message = getErrorMessage(error);

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

      await reportProgress();

      if (simulatedAmazonPrice === null && index < products.length - 1) {
        await sleep(getProductDelayMs());
      }
  }

  return result;
}

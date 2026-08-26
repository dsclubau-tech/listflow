import "server-only";

import {
  EbayActionJobStatus,
  EbayActionJobType,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  buildEndItemXML,
  buildReviseInventoryStatusXML,
  type ReviseInventoryStatusItemInput,
  buildReviseItemXML,
  buildReviseQuantityXML,
} from "@/lib/ebay-xml";
import { getEbayCustomLabel } from "@/lib/sku";
import {
  dedupeProductImages,
  removeKnownUndersizedEbayPictures,
} from "@/lib/product-images";
import {
  callEbayEndItem,
  callEbayReviseInventoryStatus,
  callEbayReviseItem,
  createEbayGeneralCampaign,
  createEbayPromotedAds,
  deleteEbayPromotedAds,
  getEbayGeneralCampaign,
  getEbayPromotedListingSync,
  getEbayPromotedListingsEligibility,
  getStoreNumber,
  updateEbayPromotedAdRates,
  type EbayPromotedListingSyncRecord,
} from "@/lib/ebay";
import {
  getEbayWriteLeaseInput,
  JobConflictError,
  withJobLeases,
  type WorkerContext,
} from "@/lib/job-coordination";
import {
  filterRunnableJobsForWorker,
  getWorkerClaimPolicy,
} from "@/lib/worker-claim-policy";
import { logger } from "@/lib/logger";
import {
  chunkInventoryReviseItems,
  getBulkEditQuantityStatus,
  getReviseListingQuantityOptions,
  isReviseListingQuantityChanged,
  shouldRetryInventoryBatchIndividually,
} from "@/lib/ebay-action-job-helpers";
import { getEbayActionQueuePositions } from "@/lib/ebay-action-queue";
import { policyIdsMatch, resolveProductPolicySelection } from "@/lib/policy-defaults";
import { prisma } from "@/lib/prisma";
import { invalidateJobCaches, invalidateProductCaches } from "@/lib/cache-tags";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { deleteProductFromListflow } from "@/lib/product-removal";
import { uploadProductToEbay } from "@/lib/ebay-upload";
import { createEbayImageFromUrl } from "@/lib/ebay-media";
import {
  getConfiguredPublicImageBaseUrl,
  prepareEbayPictureUrls,
} from "@/lib/ebay-image-urls";
import {
  isAutoHoldPriceCheckFailureCode,
  isPriceCheckAutoHoldMetadata,
} from "@/lib/price-check-failures";
import { isLowStockHoldJobMetadata } from "@/lib/low-stock-products";
import { hasRevisableEbayListing } from "@/lib/ebay-listing-state";
import {
  canonicalizePackageItemSpecifics,
  compareEbayPackageDimensions,
  fetchEbayPackageItem,
  getStoredPackageDimensions,
  mergeEbayPackageItemSpecifics,
} from "@/lib/package-data-sync";

const ACTIVE_ACTION_JOB_STATUSES: EbayActionJobStatus[] = [
  EbayActionJobStatus.QUEUED,
  EbayActionJobStatus.RUNNING,
];

type ProductFailure = {
  productId: string;
  title: string;
  error: string;
};

type ProgressUpdate = {
  productId: string;
  succeeded: boolean;
  failure: ProductFailure | null;
};

type EbayActionJobRecord = {
  id: string;
  userId: string;
  storeId: string;
  type: EbayActionJobType;
  status: EbayActionJobStatus;
  productIds: string[];
  completedProductIds: string[];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  dismissedAt: Date | null;
};

type CreateEbayActionJobInput = {
  userId: string;
  storeId: string;
  type: EbayActionJobType;
  productIds: unknown[];
  metadata?: Prisma.InputJsonValue;
};

type BulkEditRevisionProduct = {
  id: string;
  storeId: string;
  title: string;
  status: ProductStatus;
  ebayItemId: string | null;
  quantity: number;
  price: Prisma.Decimal;
  variants: Array<{ sellPrice: Prisma.Decimal }>;
};

type InventoryReviseBatchItem = {
  product: BulkEditRevisionProduct & { ebayItemId: string };
  input: ReviseInventoryStatusItemInput;
  overrideStartPrice?: number;
  quantityChanged: boolean;
};

const BULK_EDIT_PRICE_FIELDS = new Set([
  "feesPercent",
  "feesFixed",
  "profitFixed",
  "profitPercent",
  "roundCents",
]);
const BULK_EDIT_INVENTORY_FIELDS = new Set([
  ...BULK_EDIT_PRICE_FIELDS,
  "quantity",
]);

function normalizeProductIds(productIds: unknown[]) {
  if (!Array.isArray(productIds)) {
    return [];
  }

  return Array.from(
    new Set(
      productIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean)
    )
  );
}

function normalizeErrors(errors: Prisma.JsonValue): ProductFailure[] {
  return Array.isArray(errors)
    ? errors
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }

          const record = entry as Record<string, unknown>;
          return {
            productId: String(record.productId ?? ""),
            title: String(record.title ?? ""),
            error: String(record.error ?? ""),
          };
        })
        .filter((entry): entry is ProductFailure => Boolean(entry?.productId || entry?.error))
    : [];
}

function getBulkEditFields(job: EbayActionJobRecord) {
  const metadata = job.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return new Set<string>();
  }

  const fields = (metadata as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) {
    return new Set<string>();
  }

  return new Set(
    fields
      .map((field) => (typeof field === "string" ? field : ""))
      .filter(Boolean)
  );
}

function hasAnyField(fields: Set<string>, candidates: Set<string> | string[]) {
  for (const field of candidates) {
    if (fields.has(field)) {
      return true;
    }
  }

  return false;
}

function hasOnlyInventoryFields(fields: Set<string>) {
  return (
    fields.size > 0 &&
    Array.from(fields).every((field) => BULK_EDIT_INVENTORY_FIELDS.has(field))
  );
}

function isInventoryOnlyBulkEdit(fields: Set<string>) {
  return fields.size === 0 || hasOnlyInventoryFields(fields);
}

function getPrimarySellPrice(product: Pick<BulkEditRevisionProduct, "variants">) {
  const primarySellPrice =
    product.variants.length > 0 ? Number(product.variants[0].sellPrice) : null;

  return primarySellPrice !== null &&
    Number.isFinite(primarySellPrice) &&
    primarySellPrice > 0
    ? primarySellPrice
    : undefined;
}

function buildInventoryReviseBatchItem(
  product: BulkEditRevisionProduct & { ebayItemId: string },
  fields: Set<string>,
): InventoryReviseBatchItem | null {
  const priceChanged = fields.size === 0 || hasAnyField(fields, BULK_EDIT_PRICE_FIELDS);
  const quantityChanged = fields.has("quantity");
  const overrideStartPrice = getPrimarySellPrice(product);
  const startPrice = priceChanged ? overrideStartPrice ?? Number(product.price) : undefined;
  const quantity = quantityChanged ? Math.max(0, product.quantity) : undefined;

  if (startPrice === undefined && quantity === undefined) {
    return null;
  }

  return {
    product,
    input: {
      ebayItemId: product.ebayItemId,
      startPrice,
      quantity,
    },
    overrideStartPrice,
    quantityChanged,
  };
}

type SuccessfulBulkEditRevisionInput = {
  product: Pick<BulkEditRevisionProduct, "id" | "status" | "quantity">;
  overrideStartPrice?: number;
  quantityChanged: boolean;
};

function getSuccessfulBulkEditRevisionData(input: SuccessfulBulkEditRevisionInput) {
  const status = getBulkEditQuantityStatus({
    quantityChanged: input.quantityChanged,
    quantity: input.product.quantity,
    currentStatus: input.product.status,
  });

  return {
    status,
    ...(input.quantityChanged
      ? { holdReason: status === ProductStatus.ON_HOLD ? "Listing quantity was set to 0." : null }
      : {}),
    errorMessage: null,
    priceCheckError: null,
    priceCheckFailureCode: null,
    ...(input.overrideStartPrice !== undefined
      ? { price: input.overrideStartPrice }
      : {}),
  };
}

async function applySuccessfulBulkEditRevisions(
  inputs: SuccessfulBulkEditRevisionInput[],
) {
  const groupedStatusOnlyUpdates = new Map<ProductStatus, string[]>();
  const priceUpdates: SuccessfulBulkEditRevisionInput[] = [];

  for (const input of inputs) {
    if (input.overrideStartPrice !== undefined) {
      priceUpdates.push(input);
      continue;
    }

    const status = getBulkEditQuantityStatus({
      quantityChanged: input.quantityChanged,
      quantity: input.product.quantity,
      currentStatus: input.product.status,
    });
    const ids = groupedStatusOnlyUpdates.get(status) ?? [];
    ids.push(input.product.id);
    groupedStatusOnlyUpdates.set(status, ids);
  }

  await Promise.all([
    ...Array.from(groupedStatusOnlyUpdates, ([status, ids]) =>
      prisma.product.updateMany({
        where: { id: { in: ids } },
        data: {
          status,
          ...(status === ProductStatus.ON_HOLD
            ? { holdReason: "Listing quantity was set to 0." }
            : status === ProductStatus.IMPORTED
              ? { holdReason: null }
              : {}),
          errorMessage: null,
          priceCheckError: null,
          priceCheckFailureCode: null,
        },
      }),
    ),
    ...priceUpdates.map((input) =>
      prisma.product.update({
        where: { id: input.product.id },
        data: getSuccessfulBulkEditRevisionData(input),
      }),
    ),
  ]);
}

async function applySuccessfulBulkEditRevision(
  input: SuccessfulBulkEditRevisionInput,
) {
  await applySuccessfulBulkEditRevisions([input]);
}

function actionLabel(type: EbayActionJobType) {
  if (type === EbayActionJobType.UPLOAD_LISTING) return "Upload listings";
  if (type === EbayActionJobType.REVISE_LISTING) return "Update eBay listing";
  if (type === EbayActionJobType.SYNC_PACKAGE_DATA) return "Sync package data";
  if (type === EbayActionJobType.APPLY_PACKAGE_DATA) return "Update eBay package data";
  if (type === EbayActionJobType.HOLD) return "Put listings on hold";
  if (type === EbayActionJobType.RESUME) return "Resume listings";
  if (type === EbayActionJobType.BULK_EDIT_REVISE) return "Bulk edit listings";
  if (type === EbayActionJobType.MANAGE_PROMOTED_ADS) {
    return "Manage promoted listings";
  }
  return "End listings";
}

export function serializeEbayActionJob(job: EbayActionJobRecord) {
  return {
    id: job.id,
    storeId: job.storeId,
    type: job.type,
    status: job.status,
    productIds: job.productIds,
    completedProductIds: job.completedProductIds,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    errors: normalizeErrors(job.errors),
    metadata: job.metadata,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
    queuePosition: null as number | null,
  };
}

type PromotedAdsJobMetadata = {
  kind: "promoted-ads";
  operation: "APPLY" | "REMOVE";
  bidPercentage: number | null;
  campaignMode: "EXISTING" | "CREATE" | null;
  campaignId: string | null;
  campaignName: string | null;
};

function getPromotedAdsMetadata(job: EbayActionJobRecord): PromotedAdsJobMetadata {
  const record =
    job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
      ? (job.metadata as Record<string, unknown>)
      : {};
  const operation = record.operation === "REMOVE" ? "REMOVE" : "APPLY";
  const numericBid = Number(record.bidPercentage);

  return {
    kind: "promoted-ads",
    operation,
    bidPercentage:
      operation === "APPLY" && Number.isFinite(numericBid) ? numericBid : null,
    campaignMode:
      record.campaignMode === "CREATE"
        ? "CREATE"
        : record.campaignMode === "EXISTING"
          ? "EXISTING"
          : null,
    campaignId:
      typeof record.campaignId === "string" && record.campaignId.trim()
        ? record.campaignId.trim()
        : null,
    campaignName:
      typeof record.campaignName === "string" && record.campaignName.trim()
        ? record.campaignName.trim()
        : null,
  };
}

function promotionFailure(
  product: { id: string; title: string },
  error: string,
): ProductFailure {
  return { productId: product.id, title: product.title, error };
}

async function updateLocalPromotedStatus(
  productId: string,
  input:
    | { promoted: false }
    | {
        promoted: true;
        campaignId: string;
        campaignName: string;
        bidPercentage: number;
      },
) {
  const syncedAt = new Date();

  await prisma.product.update({
    where: { id: productId },
    data: input.promoted
      ? {
          promotedAdStatus: "PROMOTED",
          promotedAdPercent: input.bidPercentage,
          promotedAdCampaignId: input.campaignId,
          promotedAdCampaignName: input.campaignName,
          promotedAdRateStrategy: "FIXED",
          promotedAdSyncedAt: syncedAt,
        }
      : {
          promotedAdStatus: "NOT_PROMOTED",
          promotedAdPercent: 0,
          promotedAdCampaignId: null,
          promotedAdCampaignName: null,
          promotedAdRateStrategy: "UNKNOWN",
          promotedAdSyncedAt: syncedAt,
        },
  });
}

async function failPromotionProducts(
  job: EbayActionJobRecord,
  products: Array<{ id: string; title: string }>,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);

  for (const product of products) {
    await markProgress(job, product.id, false, promotionFailure(product, message));
  }
}

async function runPromotedAdsJob(job: EbayActionJobRecord) {
  const completed = new Set(job.completedProductIds);
  const remainingIds = job.productIds.filter((id) => !completed.has(id));
  const products = await prisma.product.findMany({
    where: { id: { in: remainingIds }, storeId: job.storeId },
    select: { id: true, title: true, ebayItemId: true, status: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const productId of remainingIds) {
    if (!productById.has(productId)) {
      await markProgress(job, productId, false, {
        productId,
        title: "(missing)",
        error: "Product was not found in the current store.",
      });
    }
  }

  const eligibleProducts = products.filter(
    (product) =>
      Boolean(product.ebayItemId) &&
      (product.status === ProductStatus.IMPORTED ||
        product.status === ProductStatus.ON_HOLD),
  );
  const ineligibleProducts = products.filter(
    (product) => !eligibleProducts.some((eligible) => eligible.id === product.id),
  );

  for (const product of ineligibleProducts) {
    await markProgress(
      job,
      product.id,
      false,
      promotionFailure(product, "Product is not an imported eBay listing."),
    );
  }

  if (eligibleProducts.length === 0) {
    return;
  }

  try {
    const metadata = getPromotedAdsMetadata(job);
    const storeNumber = await getStoreNumber(job.storeId);
    const eligibility = await getEbayPromotedListingsEligibility(storeNumber);

    if (!eligibility.eligible) {
      throw new Error(
        eligibility.reason
          ? `This eBay account is not eligible for General Promoted Listings: ${eligibility.reason}.`
          : "This eBay account is not eligible for General Promoted Listings.",
      );
    }

    const livePromotions = await getEbayPromotedListingSync(
      storeNumber,
      eligibleProducts.map((product) => String(product.ebayItemId)),
    );

    if (metadata.operation === "REMOVE") {
      const grouped = new Map<string, typeof eligibleProducts>();

      for (const product of eligibleProducts) {
        const listingId = String(product.ebayItemId);
        const current = livePromotions.get(listingId);

        if (!current) {
          await updateLocalPromotedStatus(product.id, { promoted: false });
          await markProgress(job, product.id, true, null);
          continue;
        }

        const group = grouped.get(current.campaignId) ?? [];
        group.push(product);
        grouped.set(current.campaignId, group);
      }

      for (const [campaignId, campaignProducts] of grouped) {
        try {
          const results = await deleteEbayPromotedAds(
            storeNumber,
            campaignId,
            campaignProducts.map((product) => String(product.ebayItemId)),
          );
          const byListingId = new Map(results.map((result) => [result.listingId, result]));

          for (const product of campaignProducts) {
            const result = byListingId.get(String(product.ebayItemId));
            if (!result?.success) {
              await markProgress(
                job,
                product.id,
                false,
                promotionFailure(
                  product,
                  result?.errorMessage ?? "eBay did not remove this promotion.",
                ),
              );
              continue;
            }

            await updateLocalPromotedStatus(product.id, { promoted: false });
            await markProgress(job, product.id, true, null);
          }
        } catch (error) {
          await failPromotionProducts(job, campaignProducts, error);
        }
      }

      return;
    }

    if (
      metadata.bidPercentage === null ||
      metadata.bidPercentage < 2 ||
      metadata.bidPercentage > 100
    ) {
      throw new Error("Promoted Listings rate must be between 2.0% and 100.0%.");
    }

    let targetCampaignId = metadata.campaignId;
    let targetCampaignName = metadata.campaignName;

    if (metadata.campaignMode === "CREATE") {
      if (!targetCampaignName) {
        throw new Error("Campaign name is required.");
      }
      const created = await createEbayGeneralCampaign(storeNumber, {
        campaignName: targetCampaignName,
        bidPercentage: metadata.bidPercentage,
      });
      targetCampaignId = created.campaignId;
      targetCampaignName = created.campaignName;
      const nextMetadata = {
        ...(job.metadata as Record<string, unknown>),
        campaignId: targetCampaignId,
        campaignName: targetCampaignName,
      } as Prisma.InputJsonValue;
      const updatedJob = await prisma.ebayActionJob.update({
        where: { id: job.id },
        data: { metadata: nextMetadata },
      });
      job.metadata = updatedJob.metadata;
    } else {
      const campaign = targetCampaignId
        ? await getEbayGeneralCampaign(storeNumber, targetCampaignId)
        : null;
      if (!campaign || !campaign.supported || campaign.rateStrategy !== "FIXED") {
        throw new Error("The selected eBay campaign is unavailable or is not fixed-rate.");
      }
      targetCampaignName = campaign.campaignName;
    }

    if (!targetCampaignId || !targetCampaignName) {
      throw new Error("A valid eBay campaign is required.");
    }

    const createProducts: typeof eligibleProducts = [];
    const updateProducts: typeof eligibleProducts = [];
    const moveProductsByCampaign = new Map<
      string,
      Array<{ product: (typeof eligibleProducts)[number]; current: EbayPromotedListingSyncRecord }>
    >();

    for (const product of eligibleProducts) {
      const current = livePromotions.get(String(product.ebayItemId));
      if (!current) {
        createProducts.push(product);
      } else if (current.campaignId === targetCampaignId) {
        updateProducts.push(product);
      } else if (current.rateStrategy !== "FIXED" || current.bidPercentage === null) {
        await markProgress(
          job,
          product.id,
          false,
          promotionFailure(
            product,
            "This listing is in a dynamic campaign. Remove that promotion first before moving it to a fixed-rate campaign.",
          ),
        );
      } else {
        const group = moveProductsByCampaign.get(current.campaignId) ?? [];
        group.push({ product, current });
        moveProductsByCampaign.set(current.campaignId, group);
      }
    }

    if (updateProducts.length > 0) {
      try {
        const results = await updateEbayPromotedAdRates(
          storeNumber,
          targetCampaignId,
          updateProducts.map((product) => String(product.ebayItemId)),
          metadata.bidPercentage,
        );
        const byListingId = new Map(results.map((result) => [result.listingId, result]));
        for (const product of updateProducts) {
          const result = byListingId.get(String(product.ebayItemId));
          if (!result?.success) {
            await markProgress(
              job,
              product.id,
              false,
              promotionFailure(product, result?.errorMessage ?? "Rate update failed."),
            );
            continue;
          }
          await updateLocalPromotedStatus(product.id, {
            promoted: true,
            campaignId: targetCampaignId,
            campaignName: targetCampaignName,
            bidPercentage: metadata.bidPercentage,
          });
          await markProgress(job, product.id, true, null);
        }
      } catch (error) {
        await failPromotionProducts(job, updateProducts, error);
      }
    }

    const movedProducts = new Map<
      string,
      { product: (typeof eligibleProducts)[number]; current: EbayPromotedListingSyncRecord }
    >();
    for (const [oldCampaignId, entries] of moveProductsByCampaign) {
      try {
        const results = await deleteEbayPromotedAds(
          storeNumber,
          oldCampaignId,
          entries.map(({ product }) => String(product.ebayItemId)),
        );
        const byListingId = new Map(results.map((result) => [result.listingId, result]));
        for (const entry of entries) {
          const listingId = String(entry.product.ebayItemId);
          const result = byListingId.get(listingId);
          if (result?.success) {
            movedProducts.set(listingId, entry);
            createProducts.push(entry.product);
          } else {
            await markProgress(
              job,
              entry.product.id,
              false,
              promotionFailure(
                entry.product,
                result?.errorMessage ?? "Could not remove the listing from its old campaign.",
              ),
            );
          }
        }
      } catch (error) {
        await failPromotionProducts(
          job,
          entries.map(({ product }) => product),
          error,
        );
      }
    }

    if (createProducts.length > 0) {
      try {
        const results = await createEbayPromotedAds(
          storeNumber,
          targetCampaignId,
          createProducts.map((product) => String(product.ebayItemId)),
          metadata.bidPercentage,
        );
        const byListingId = new Map(results.map((result) => [result.listingId, result]));

        for (const product of createProducts) {
          const listingId = String(product.ebayItemId);
          const result = byListingId.get(listingId);
          if (result?.success) {
            await updateLocalPromotedStatus(product.id, {
              promoted: true,
              campaignId: targetCampaignId,
              campaignName: targetCampaignName,
              bidPercentage: metadata.bidPercentage,
            });
            await markProgress(job, product.id, true, null);
            continue;
          }

          const moved = movedProducts.get(listingId);
          let rollbackMessage = "";
          if (moved && moved.current.bidPercentage !== null) {
            try {
              const rollback = await createEbayPromotedAds(
                storeNumber,
                moved.current.campaignId,
                [listingId],
                moved.current.bidPercentage,
              );
              rollbackMessage = rollback[0]?.success
                ? " The original promotion was restored."
                : ` The original promotion could not be restored: ${rollback[0]?.errorMessage ?? "unknown error"}`;
            } catch (rollbackError) {
              rollbackMessage = ` The original promotion could not be restored: ${
                rollbackError instanceof Error ? rollbackError.message : "unknown error"
              }`;
            }
          }

          await markProgress(
            job,
            product.id,
            false,
            promotionFailure(
              product,
              `${result?.errorMessage ?? "Could not add this listing to the campaign."}${rollbackMessage}`,
            ),
          );
        }
      } catch (error) {
        const createError =
          error instanceof Error ? error.message : String(error);

        for (const product of createProducts) {
          const listingId = String(product.ebayItemId);
          const moved = movedProducts.get(listingId);
          let rollbackMessage = "";

          if (moved && moved.current.bidPercentage !== null) {
            try {
              const rollback = await createEbayPromotedAds(
                storeNumber,
                moved.current.campaignId,
                [listingId],
                moved.current.bidPercentage,
              );
              rollbackMessage = rollback[0]?.success
                ? " The original promotion was restored."
                : ` The original promotion could not be restored: ${rollback[0]?.errorMessage ?? "unknown error"}`;
            } catch (rollbackError) {
              rollbackMessage = ` The original promotion could not be restored: ${
                rollbackError instanceof Error
                  ? rollbackError.message
                  : "unknown error"
              }`;
            }
          }

          await markProgress(
            job,
            product.id,
            false,
            promotionFailure(product, `${createError}${rollbackMessage}`),
          );
        }
      }
    }
  } catch (error) {
    const unfinished = eligibleProducts.filter(
      (product) => !job.completedProductIds.includes(product.id),
    );
    await failPromotionProducts(job, unfinished, error);
  }
}

async function markProgress(
  job: EbayActionJobRecord,
  productId: string,
  succeeded: boolean,
  failure: ProductFailure | null
) {
  await markProgressBatch(job, [{ productId, succeeded, failure }]);
}

async function markProgressBatch(
  job: EbayActionJobRecord,
  updates: ProgressUpdate[],
) {
  if (updates.length === 0) {
    return;
  }

  const completed = new Set(job.completedProductIds);
  const errors = normalizeErrors(job.errors);
  let succeededCount = 0;
  let failedCount = 0;

  for (const update of updates) {
    completed.add(update.productId);

    if (update.failure) {
      errors.push(update.failure);
    }

    if (update.succeeded) {
      succeededCount += 1;
    } else {
      failedCount += 1;
    }
  }

  const updated = await prisma.ebayActionJob.update({
    where: { id: job.id },
    data: {
      completedProductIds: { set: job.productIds.filter((id) => completed.has(id)) },
      processed: Math.min(job.total, job.processed + updates.length),
      succeeded: job.succeeded + succeededCount,
      failed: job.failed + failedCount,
      errors: errors as unknown as Prisma.InputJsonValue,
    },
  });

  Object.assign(job, updated);
}

async function processProduct(job: EbayActionJobRecord, productId: string) {
  const automaticPriceCheckHold =
    job.type === EbayActionJobType.HOLD &&
    isPriceCheckAutoHoldMetadata(job.metadata);
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: job.storeId },
    include: {
      store: true,
      variants: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!product) {
    if (automaticPriceCheckHold) {
      return { ok: true, failure: null };
    }

    return {
      ok: false,
      failure: { productId, title: "(missing)", error: "Product was not found" },
    };
  }

  if (job.type === EbayActionJobType.UPLOAD_LISTING) {
    const result = await uploadProductToEbay({
      productId,
      storeId: job.storeId,
      userId: job.userId,
      log: logger,
    });

    return result.ok
      ? { ok: true, failure: null }
      : {
          ok: false,
          failure: {
            productId,
            title: result.productTitle || product.title,
            error: result.body.error || "Upload failed.",
          },
        };
  }

  if (job.type === EbayActionJobType.SYNC_PACKAGE_DATA) {
    if (!product.ebayItemId) {
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: "Product is not currently listed on eBay",
        },
      };
    }

    try {
      const storeNumber = await getStoreNumber(product.storeId);
      const ebayItem = await fetchEbayPackageItem({
        ebayItemId: product.ebayItemId,
        storeNumber,
      });
      const itemSpecifics = mergeEbayPackageItemSpecifics({
        itemSpecifics: product.itemSpecifics,
        ebayItem,
      });

      await prisma.product.update({
        where: { id: product.id },
        data: { itemSpecifics, errorMessage: null },
      });

      logger.info("ebay-action/jobs", "eBay package data synchronized", {
        jobId: job.id,
        productId,
        ebayItemId: product.ebayItemId,
        hasEbayPackageData: Boolean(getStoredPackageDimensions(itemSpecifics)),
      });
      return { ok: true, failure: null };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Package data synchronization failed";
      return {
        ok: false,
        failure: { productId, title: product.title, error: errorMessage },
      };
    }
  }

  if (job.type === EbayActionJobType.APPLY_PACKAGE_DATA) {
    if (product.status !== ProductStatus.IMPORTED || !product.ebayItemId) {
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: "Product is not currently listed on eBay",
        },
      };
    }

    try {
      const itemSpecifics = canonicalizePackageItemSpecifics(product.itemSpecifics);
      if (!getStoredPackageDimensions(itemSpecifics)) {
        return {
          ok: false,
          failure: {
            productId,
            title: product.title,
            error: "No complete package weight or dimensions are available in ListFlow.",
          },
        };
      }

      const storeNumber = await getStoreNumber(product.storeId);
      const result = await callEbayReviseItem(
        buildReviseItemXML(
          { ...product, itemSpecifics },
          undefined,
          {
            includeTitle: false,
            includeDescription: false,
            includeStartPrice: false,
            includeDispatchTimeMax: false,
            includeQuantity: false,
            includeSellerProfiles: false,
            includeLocation: false,
            includeItemSpecifics: false,
            includePictures: false,
            includeShippingPackage: true,
          },
        ),
        storeNumber,
      );

      if (!result.success) {
        return {
          ok: false,
          failure: {
            productId,
            title: product.title,
            error: result.errorMessage || "eBay package update failed",
          },
        };
      }

      const ebayItem = await fetchEbayPackageItem({
        ebayItemId: product.ebayItemId,
        storeNumber,
      });
      const verification = compareEbayPackageDimensions({ itemSpecifics, ebayItem });
      const verifiedItemSpecifics = {
        ...itemSpecifics,
        _EbayPackageVerification: verification.status,
        _EbayPackageVerifiedAt: new Date().toISOString(),
      };

      await prisma.product.update({
        where: { id: product.id },
        data: { itemSpecifics: verifiedItemSpecifics },
      });

      if (verification.status !== "confirmed") {
        return {
          ok: false,
          failure: {
            productId,
            title: product.title,
            error: `eBay accepted the package update but verification was ${verification.status}.`,
          },
        };
      }

      logger.info("ebay-action/jobs", "eBay package data update confirmed", {
        jobId: job.id,
        productId,
        ebayItemId: product.ebayItemId,
        verification,
      });
      return { ok: true, failure: null };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "eBay package update failed";
      return {
        ok: false,
        failure: { productId, title: product.title, error: errorMessage },
      };
    }
  }

  if (job.type === EbayActionJobType.REVISE_LISTING) {
    if (!hasRevisableEbayListing(product)) {
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: "Product has no active eBay listing reference",
        },
      };
    }

    try {
      const quantityChanged = isReviseListingQuantityChanged(job.metadata);
      const quantityOptions = getReviseListingQuantityOptions({
        quantityChanged,
        quantity: product.quantity,
      });
      const policySelection = await resolveProductPolicySelection(
        product.storeId,
        {
          shippingPolicyId: product.shippingPolicyId,
          returnPolicyId: product.returnPolicyId,
          paymentPolicyId: product.paymentPolicyId,
        },
        product.policyTemplateId,
      );
      const productWithPolicies = {
        ...product,
        shippingPolicyId: policySelection.shippingPolicyId,
        returnPolicyId: policySelection.returnPolicyId,
        paymentPolicyId: policySelection.paymentPolicyId,
        policyTemplateId: policySelection.policyTemplateId,
      };
      const finalDescription = await resolveDescriptionTemplate(productWithPolicies);
      const overrideStartPrice = getPrimarySellPrice(product);
      const storeNumber = await getStoreNumber(product.storeId);
      const preparedImages = await prepareEbayPictureUrls({
        images: product.images,
        publicImageBaseUrl: getConfiguredPublicImageBaseUrl(),
        stageExternalImage: (sourceUrl) =>
          createEbayImageFromUrl({
            sourceUrl,
            storeId: product.storeId,
            storeNumber,
          }),
      });
      const result = await callEbayReviseItem(
        buildReviseItemXML(
          {
            ...productWithPolicies,
            description: finalDescription,
            images: preparedImages,
          },
          overrideStartPrice,
          {
            includePictures: true,
            includeItemSpecifics: true,
            includeShippingPackage: true,
            ...quantityOptions,
          },
        ),
        storeNumber,
      );

      if (!result.success) {
        const errorMessage = result.errorMessage || "eBay listing update failed";
        await prisma.product.update({
          where: { id: product.id },
          data: { errorMessage },
        });
        return {
          ok: false,
          failure: { productId, title: product.title, error: errorMessage },
        };
      }

      const revisedStatus = getBulkEditQuantityStatus({
        quantityChanged,
        quantity: product.quantity,
        currentStatus: product.status,
      });

      await prisma.product.update({
        where: { id: product.id },
        data: {
          images: preparedImages,
          status: revisedStatus,
          ...(quantityChanged
            ? {
                holdReason:
                  revisedStatus === ProductStatus.ON_HOLD
                    ? "Listing quantity was set to 0."
                    : null,
              }
            : {}),
          errorMessage: null,
          shippingPolicyId: policySelection.shippingPolicyId,
          returnPolicyId: policySelection.returnPolicyId,
          paymentPolicyId: policySelection.paymentPolicyId,
          policyTemplateId: policySelection.policyTemplateId,
          ...(overrideStartPrice !== undefined
            ? { price: overrideStartPrice }
            : {}),
        },
      });

      logger.info("ebay-action/jobs", "eBay listing revision succeeded", {
        jobId: job.id,
        productId,
        ebayItemId: product.ebayItemId,
        imageCount: preparedImages.length,
      });
      return { ok: true, failure: null };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "eBay listing update failed";
      await prisma.product.update({
        where: { id: product.id },
        data: { errorMessage },
      });
      return {
        ok: false,
        failure: { productId, title: product.title, error: errorMessage },
      };
    }
  }

  if (job.type === EbayActionJobType.HOLD) {
    if (
      automaticPriceCheckHold &&
      (product.status !== ProductStatus.IMPORTED ||
        !product.priceCheckError ||
        !isAutoHoldPriceCheckFailureCode(product.priceCheckFailureCode))
    ) {
      return { ok: true, failure: null };
    }

    if (
      (product.status !== ProductStatus.IMPORTED &&
        product.status !== ProductStatus.ON_HOLD) ||
      !product.ebayItemId
    ) {
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: "Product is not imported or lacks an eBay Item ID",
        },
      };
    }

    const storeNumber = await getStoreNumber(product.storeId);
    const result = await callEbayReviseItem(
      buildReviseQuantityXML(product.ebayItemId, 0),
      storeNumber
    );

    if (!result.success) {
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: result.errorMessage || "Unknown eBay API error",
        },
      };
    }

    let holdReason = "Put on hold manually.";
    if (automaticPriceCheckHold) {
      holdReason = product.priceCheckError?.trim()
        ? `Automatic hold after failed price check: ${product.priceCheckError.trim()}`
        : "Automatic hold after failed price check.";
    } else if (isLowStockHoldJobMetadata(job.metadata)) {
      holdReason =
        product.amazonStockLeft !== null
          ? `Low Amazon stock (${product.amazonStockLeft} left).`
          : "Low Amazon stock.";
    } else if (product.quantity <= 0) {
      holdReason = "Listing quantity was set to 0.";
    } else if (
      product.amazonStockLeft !== null &&
      product.amazonStockLeft <= 3
    ) {
      holdReason = `Low Amazon stock (${product.amazonStockLeft} left).`;
    }

    await prisma.product.update({
      where: { id: product.id },
      data: {
        status: ProductStatus.ON_HOLD,
        quantity: 0,
        holdReason,
        ...(automaticPriceCheckHold
          ? {}
          : { priceCheckError: null, priceCheckFailureCode: null }),
      },
    });
    return { ok: true, failure: null };
  }

  if (job.type === EbayActionJobType.RESUME) {
    if (
      (product.status !== ProductStatus.ON_HOLD &&
        product.status !== ProductStatus.IMPORTED) ||
      !product.ebayItemId
    ) {
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: "Product is not on hold or lacks an eBay Item ID",
        },
      };
    }

    const storeNumber = await getStoreNumber(product.storeId);
    const restoreQty = Math.max(1, product.quantity);
    const result = await callEbayReviseItem(
      buildReviseQuantityXML(product.ebayItemId, restoreQty),
      storeNumber
    );

    if (!result.success) {
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: result.errorMessage || "Unknown eBay API error",
        },
      };
    }

    await prisma.product.update({
      where: { id: product.id },
      data: {
        status: ProductStatus.IMPORTED,
        holdReason: null,
      },
    });
    return { ok: true, failure: null };
  }

  if (job.type === EbayActionJobType.BULK_EDIT_REVISE) {
    if (
      (product.status !== ProductStatus.IMPORTED &&
        product.status !== ProductStatus.ON_HOLD) ||
      !product.ebayItemId
    ) {
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: "Product is not imported/on hold or lacks an eBay Item ID",
        },
      };
    }

    const bulkEditFields = getBulkEditFields(job);
    const skuChanged = bulkEditFields.has("sku");
    const customLabel = skuChanged
      ? getEbayCustomLabel({
          variantSku: product.variants[0]?.sku,
          asin: product.asin,
          automaticSkuFilling: true,
        })
      : null;

    if (skuChanged && bulkEditFields.size === 1) {
      if (!customLabel) {
        return {
          ok: false,
          failure: {
            productId,
            title: product.title,
            error: "A valid SKU or Amazon ASIN is required",
          },
        };
      }

      const storeNumber = await getStoreNumber(product.storeId);
      let result = await callEbayReviseItem(
        buildReviseItemXML(product, undefined, {
          customLabel,
          includeSku: true,
          includeTitle: false,
          includeDescription: false,
          includeStartPrice: false,
          includeDispatchTimeMax: false,
          includeQuantity: false,
          includeSellerProfiles: false,
          includeLocation: false,
        }),
        storeNumber,
      );

      let revisedImages: string[] | null = null;
      const originalImages = dedupeProductImages(product.images);
      const compliantImages = removeKnownUndersizedEbayPictures(product.images);
      const isPicturePolicyFailure =
        !result.success &&
        /picture policy|at least 500 pixels/i.test(result.errorMessage ?? "");

      if (
        isPicturePolicyFailure &&
        compliantImages.length > 0 &&
        compliantImages.length < originalImages.length
      ) {
        result = await callEbayReviseItem(
          buildReviseItemXML(
            { ...product, images: compliantImages },
            undefined,
            {
              customLabel,
              includeSku: true,
              includeTitle: false,
              includeDescription: false,
              includeStartPrice: false,
              includeDispatchTimeMax: false,
              includeQuantity: false,
              includeSellerProfiles: false,
              includeLocation: false,
              includePictures: true,
            },
          ),
          storeNumber,
        );

        if (result.success) {
          revisedImages = compliantImages;
        }
      }

      if (!result.success) {
        const errorMessage = result.errorMessage || "SKU update failed";
        await prisma.product.update({
          where: { id: product.id },
          data: { errorMessage },
        });
        return {
          ok: false,
          failure: { productId, title: product.title, error: errorMessage },
        };
      }

      await prisma.product.update({
        where: { id: product.id },
        data: {
          errorMessage: null,
          ...(revisedImages ? { images: revisedImages } : {}),
        },
      });
      return { ok: true, failure: null };
    }

    const policySelection = await resolveProductPolicySelection(
      product.storeId,
      {
        shippingPolicyId: product.shippingPolicyId,
        returnPolicyId: product.returnPolicyId,
        paymentPolicyId: product.paymentPolicyId,
      },
      product.policyTemplateId
    );
    const productWithPolicies = {
      ...product,
      shippingPolicyId: policySelection.shippingPolicyId,
      returnPolicyId: policySelection.returnPolicyId,
      paymentPolicyId: policySelection.paymentPolicyId,
      policyTemplateId: policySelection.policyTemplateId,
    };

    if (!policyIdsMatch(product, productWithPolicies)) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          shippingPolicyId: policySelection.shippingPolicyId,
          returnPolicyId: policySelection.returnPolicyId,
          paymentPolicyId: policySelection.paymentPolicyId,
          policyTemplateId: policySelection.policyTemplateId,
        },
      });
    }

    const priceChanged =
      bulkEditFields.size === 0 || hasAnyField(bulkEditFields, BULK_EDIT_PRICE_FIELDS);
    const quantityChanged = bulkEditFields.has("quantity");
    const descriptionChanged =
      bulkEditFields.has("title") || bulkEditFields.has("templateId");
    const policyChanged = hasAnyField(bulkEditFields, [
      "shippingPolicyId",
      "returnPolicyId",
      "paymentPolicyId",
      "policyTemplateId",
    ]);
    const overrideStartPrice = getPrimarySellPrice(product);
    const storeNumber = await getStoreNumber(product.storeId);
    let result: { success: boolean; errorMessage?: string };
    const holdFromQuantity = quantityChanged && product.quantity <= 0;
    const resumeFromQuantity =
      quantityChanged &&
      !holdFromQuantity &&
      product.status === ProductStatus.ON_HOLD &&
      product.quantity >= 1;

    if (isInventoryOnlyBulkEdit(bulkEditFields)) {
      const inventoryQuantity =
        quantityChanged
          ? Math.max(0, product.quantity)
          : undefined;
      const inventoryPrice =
        priceChanged ? overrideStartPrice ?? Number(product.price) : undefined;

      result =
        inventoryPrice === undefined && inventoryQuantity === undefined
          ? { success: true }
          : await callEbayReviseInventoryStatus(
              buildReviseInventoryStatusXML(product.ebayItemId, {
                startPrice: inventoryPrice,
                quantity: inventoryQuantity,
              }),
              storeNumber
            );
    } else {
      const includeQuantity =
        quantityChanged &&
        !holdFromQuantity &&
        !resumeFromQuantity &&
        product.status !== ProductStatus.ON_HOLD &&
        product.quantity >= 1;
      const finalDescription = descriptionChanged
        ? await resolveDescriptionTemplate(productWithPolicies)
        : productWithPolicies.description;

      result = await callEbayReviseItem(
        buildReviseItemXML(
          {
            ...productWithPolicies,
            description: finalDescription,
          },
          priceChanged ? overrideStartPrice : undefined,
          {
            customLabel,
            includeSku: skuChanged,
            includeTitle: bulkEditFields.has("title"),
            includeDescription: descriptionChanged,
            includeStartPrice: priceChanged,
            includeDispatchTimeMax: bulkEditFields.has("dispatchTimeMax"),
            includeQuantity,
            quantityOverride: includeQuantity ? Math.max(1, product.quantity) : undefined,
            includeSellerProfiles: policyChanged,
            includeLocation: bulkEditFields.has("location"),
            includeItemSpecifics: bulkEditFields.has("brand"),
          }
        ),
        storeNumber
      );

      if (result.success && (holdFromQuantity || resumeFromQuantity)) {
        result = await callEbayReviseInventoryStatus(
          buildReviseInventoryStatusXML(product.ebayItemId, {
            quantity: holdFromQuantity ? 0 : Math.max(1, product.quantity),
          }),
          storeNumber
        );
      }
    }

    if (!result.success) {
      await prisma.product.update({
        where: { id: product.id },
        data: { errorMessage: result.errorMessage || "Bulk edit revise failed" },
      });

      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: result.errorMessage || "Unknown eBay API error",
        },
      };
    }

    await applySuccessfulBulkEditRevision({
      product,
      overrideStartPrice,
      quantityChanged,
    });

    return { ok: true, failure: null };
  }

  if (
    (product.status !== ProductStatus.IMPORTED &&
      product.status !== ProductStatus.ON_HOLD) ||
    !product.ebayItemId
  ) {
    return {
      ok: false,
      failure: {
        productId,
        title: product.title,
        error: "Product is not listed on eBay or lacks an eBay Item ID",
      },
    };
  }

  const storeNumber = await getStoreNumber(product.storeId);
  const result = await callEbayEndItem(buildEndItemXML(product.ebayItemId), storeNumber);
  const alreadyEnded =
    result.errorMessage?.toLowerCase().includes("already ended") ||
    result.errorMessage?.toLowerCase().includes("invalid item") ||
    result.errorMessage?.toLowerCase().includes("does not exist") ||
    result.errorMessage?.toLowerCase().includes("not found");

  if (!result.success && !alreadyEnded) {
    return {
      ok: false,
      failure: {
        productId,
        title: product.title,
        error: result.errorMessage || "Unknown eBay API error",
      },
    };
  }

  await deleteProductFromListflow(product.storeId, product.id);
  return { ok: true, failure: null };
}

async function fallbackInventoryReviseBatch(
  job: EbayActionJobRecord,
  batch: InventoryReviseBatchItem[],
  error?: unknown,
) {
  if (error) {
    logger.warn("ebay-action/jobs", "Batch inventory revise failed; retrying individually", {
      jobId: job.id,
      itemCount: batch.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const progressUpdates: ProgressUpdate[] = [];

  for (const item of batch) {
    try {
      const result = await processProduct(job, item.product.id);
      progressUpdates.push({
        productId: item.product.id,
        succeeded: result.ok,
        failure: result.failure,
      });
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : "Internal error";
      logger.error("ebay-action/jobs", "eBay action product failed", fallbackError, {
        jobId: job.id,
        productId: item.product.id,
      });
      progressUpdates.push({
        productId: item.product.id,
        succeeded: false,
        failure: {
          productId: item.product.id,
          title: item.product.title,
          error: message,
        },
      });
    }
  }

  await markProgressBatch(job, progressUpdates);
}

async function markInventoryReviseBatchFailure(
  job: EbayActionJobRecord,
  batch: InventoryReviseBatchItem[],
  errorMessage: string,
) {
  await prisma.product.updateMany({
    where: { id: { in: batch.map((item) => item.product.id) } },
    data: { errorMessage },
  });
  await markProgressBatch(
    job,
    batch.map((item) => ({
      productId: item.product.id,
      succeeded: false,
      failure: {
        productId: item.product.id,
        title: item.product.title,
        error: errorMessage,
      },
    })),
  );
}

async function markInventoryReviseBatchSuccess(
  job: EbayActionJobRecord,
  batch: InventoryReviseBatchItem[],
) {
  try {
    await applySuccessfulBulkEditRevisions(
      batch.map((item) => ({
        product: item.product,
        overrideStartPrice: item.overrideStartPrice,
        quantityChanged: item.quantityChanged,
      })),
    );
    await markProgressBatch(
      job,
      batch.map((item) => ({
        productId: item.product.id,
        succeeded: true,
        failure: null,
      })),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    logger.error("ebay-action/jobs", "Bulk inventory local update failed", error, {
      jobId: job.id,
      itemCount: batch.length,
    });
    await markProgressBatch(
      job,
      batch.map((item) => ({
        productId: item.product.id,
        succeeded: false,
        failure: {
          productId: item.product.id,
          title: item.product.title,
          error: message,
        },
      })),
    );
  }
}

async function processInventoryReviseBatch(
  job: EbayActionJobRecord,
  batch: InventoryReviseBatchItem[],
  storeNumber: 1 | 2 | 3,
) {
  if (batch.length === 0) {
    return;
  }

  let result: { success: boolean; errorMessage?: string };

  try {
    result = await callEbayReviseInventoryStatus(
      buildReviseInventoryStatusXML(batch.map((item) => item.input)),
      storeNumber,
    );
  } catch (error) {
    await fallbackInventoryReviseBatch(job, batch, error);
    return;
  }

  if (result.success) {
    await markInventoryReviseBatchSuccess(job, batch);
    return;
  }

  if (
    shouldRetryInventoryBatchIndividually({
      success: result.success,
      itemCount: batch.length,
    })
  ) {
    await fallbackInventoryReviseBatch(job, batch, new Error(result.errorMessage));
    return;
  }

  await markInventoryReviseBatchFailure(
    job,
    batch,
    result.errorMessage || "Unknown eBay API error",
  );
}

async function runBulkInventoryReviseJob(job: EbayActionJobRecord) {
  const fields = getBulkEditFields(job);
  const quantityChanged = fields.has("quantity");
  const completed = new Set(job.completedProductIds);
  const remainingIds = job.productIds.filter((productId) => !completed.has(productId));
  const products = await prisma.product.findMany({
    where: { id: { in: remainingIds }, storeId: job.storeId },
    select: {
      id: true,
      storeId: true,
      title: true,
      status: true,
      ebayItemId: true,
      quantity: true,
      price: true,
      variants: {
        orderBy: { createdAt: "asc" },
        select: { sellPrice: true },
      },
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const batchItems: InventoryReviseBatchItem[] = [];
  const preBatchProgressUpdates: ProgressUpdate[] = [];

  for (const productId of remainingIds) {
    const product = productById.get(productId);

    if (!product) {
      preBatchProgressUpdates.push({
        productId,
        succeeded: false,
        failure: {
          productId,
          title: "(missing)",
          error: "Product was not found",
        },
      });
      continue;
    }

    if (
      (product.status !== ProductStatus.IMPORTED &&
        product.status !== ProductStatus.ON_HOLD) ||
      !product.ebayItemId
    ) {
      preBatchProgressUpdates.push({
        productId: product.id,
        succeeded: false,
        failure: {
          productId: product.id,
          title: product.title,
          error: "Product is not imported/on hold or lacks an eBay Item ID",
        },
      });
      continue;
    }

    const batchItem = buildInventoryReviseBatchItem(
      { ...product, ebayItemId: product.ebayItemId },
      fields,
    );

    if (!batchItem) {
      try {
        await applySuccessfulBulkEditRevision({
          product,
          quantityChanged,
        });
        preBatchProgressUpdates.push({
          productId: product.id,
          succeeded: true,
          failure: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        logger.error("ebay-action/jobs", "Bulk inventory local update failed", error, {
          jobId: job.id,
          productId: product.id,
        });
        preBatchProgressUpdates.push({
          productId: product.id,
          succeeded: false,
          failure: {
            productId: product.id,
            title: product.title,
            error: message,
          },
        });
      }
      continue;
    }

    batchItems.push(batchItem);
  }

  await markProgressBatch(job, preBatchProgressUpdates);

  if (batchItems.length === 0) {
    return;
  }

  const storeNumber = await getStoreNumber(job.storeId);

  for (const batch of chunkInventoryReviseItems(batchItems)) {
    await processInventoryReviseBatch(job, batch, storeNumber);
  }
}

async function runEbayActionJobClaimed(jobId: string) {
  const job = await prisma.ebayActionJob.findUnique({ where: { id: jobId } });

  if (!job || !ACTIVE_ACTION_JOB_STATUSES.includes(job.status)) {
    return;
  }

  await prisma.ebayActionJob.update({
    where: { id: job.id },
    data: {
      status: EbayActionJobStatus.RUNNING,
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
    },
  });
  Object.assign(job, { status: EbayActionJobStatus.RUNNING });

  if (job.type === EbayActionJobType.MANAGE_PROMOTED_ADS) {
    await runPromotedAdsJob(job);
  } else if (
    job.type === EbayActionJobType.BULK_EDIT_REVISE &&
    isInventoryOnlyBulkEdit(getBulkEditFields(job))
  ) {
    await runBulkInventoryReviseJob(job);
  } else {
    const completed = new Set(job.completedProductIds);
    const remaining = job.productIds.filter((productId) => !completed.has(productId));

    for (const productId of remaining) {
      try {
        const result = await processProduct(job, productId);
        await markProgress(job, productId, result.ok, result.failure);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        logger.error("ebay-action/jobs", "eBay action product failed", error, {
          jobId: job.id,
          productId,
        });
        await markProgress(job, productId, false, {
          productId,
          title: "(unknown)",
          error: message,
        });
      }
    }
  }

  const finalStatus =
    job.failed > 0 && job.succeeded === 0
      ? EbayActionJobStatus.FAILED
      : EbayActionJobStatus.COMPLETED;

  await prisma.ebayActionJob.update({
    where: { id: job.id },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      errorMessage:
        finalStatus === EbayActionJobStatus.FAILED
          ? `${actionLabel(job.type)} failed for all products.`
          : null,
    },
  });

  invalidateProductCaches(job.storeId);
  invalidateJobCaches(job.storeId);
}

async function runEbayActionJob(jobId: string, worker?: WorkerContext) {
  if (!worker) {
    await runEbayActionJobClaimed(jobId);
    return;
  }

  const job = await prisma.ebayActionJob.findUnique({ where: { id: jobId } });

  if (!job || !ACTIVE_ACTION_JOB_STATUSES.includes(job.status)) {
    return;
  }

  await withJobLeases(
    getEbayWriteLeaseInput(
      job.storeId,
      "EBAY_ACTION",
      job.id,
      worker,
      actionLabel(job.type),
      job.createdAt,
    ),
    () => runEbayActionJobClaimed(job.id)
  );
}

export async function createEbayActionJob(input: CreateEbayActionJobInput) {
  const productIds = normalizeProductIds(input.productIds);

  const job = await prisma.ebayActionJob.create({
    data: {
      userId: input.userId,
      storeId: input.storeId,
      type: input.type,
      status:
        productIds.length > 0
          ? EbayActionJobStatus.QUEUED
          : EbayActionJobStatus.COMPLETED,
      productIds,
      total: productIds.length,
      metadata: input.metadata ?? {},
      completedAt: productIds.length > 0 ? null : new Date(),
    },
  });

  return { job: serializeEbayActionJob(job), queued: productIds.length > 0 };
}

export async function getCurrentEbayActionJobs(storeId: string) {
  const [activeJobs, recentTerminalJobs] = await Promise.all([
    prisma.ebayActionJob.findMany({
      where: {
        storeId,
        dismissedAt: null,
        status: { in: ACTIVE_ACTION_JOB_STATUSES },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.ebayActionJob.findMany({
      where: {
        storeId,
        dismissedAt: null,
        status: { notIn: ACTIVE_ACTION_JOB_STATUSES },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  const jobs = [...activeJobs, ...recentTerminalJobs];
  const queuePositions = getEbayActionQueuePositions(jobs);

  return jobs.map((job) => ({
    ...serializeEbayActionJob(job),
    queuePosition: queuePositions.get(job.id) ?? null,
  }));
}

export async function runNextEbayActionJobForStore(
  storeId: string,
  worker?: WorkerContext
) {
  const candidates = await prisma.ebayActionJob.findMany({
    where: {
      storeId,
      status: { in: ACTIVE_ACTION_JOB_STATUSES },
      dismissedAt: null,
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  const policy = worker ? await getWorkerClaimPolicy(storeId, worker) : null;
  const jobs = filterRunnableJobsForWorker(candidates, worker, policy);

  for (const job of jobs) {
    try {
      await runEbayActionJob(job.id, worker);
      return true;
    } catch (error) {
      if (error instanceof JobConflictError) {
        continue;
      }

      throw error;
    }
  }

  return false;
}

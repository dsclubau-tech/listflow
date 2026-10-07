import { executeBulkInventoryEdit } from "./ebay-bulk-inventory";
import { readEbayInventory, writeEbayInventory } from "./ebay-inventory-writer";
import { assertDistinctParentSku, InventoryBlocker, inventorySummary, type InventoryPlan, type InventoryRequest, type InventoryResult } from "./ebay-inventory";
import { resolveDeferredPricing } from "./ebay-deferred-pricing";
import { assertAmazonObservationCurrent, SupersededAmazonObservation } from "@/lib/price-check-result-application";
import "server-only";

import { createBulkEditJobWithItems } from "@/lib/bulk-edit-job-creation";

import {
  EbayActionJobStatus,
  EbayActionJobType,
  ProductStatus,
  ProductHoldOrigin,
  PriceCheckFailureCode,
} from "@/app/generated/prisma/enums";
import { Prisma } from "@/app/generated/prisma/client";
import {
  buildEndItemXML,
  buildReviseItemXML,
} from "@/lib/ebay-xml";
import { getEbayCustomLabel } from "@/lib/sku";
import {
  dedupeProductImages,
  removeKnownUndersizedEbayPictures,
} from "@/lib/product-images";
import {
  callEbayEndItem,
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
  isReviseListingQuantityChanged,
} from "@/lib/ebay-action-job-helpers";
import { getEbayActionQueuePositions } from "@/lib/ebay-action-queue";
import {
  finishEbayActionCancellation,
  isEbayActionCancellationRequested,
} from "@/lib/ebay-action-cancellation";
import { resolveProductPolicySelection } from "@/lib/policy-defaults";
import { prisma } from "@/lib/prisma";
import { invalidateJobCaches, invalidateProductCaches } from "@/lib/cache-tags";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { deleteProductFromListflow } from "@/lib/product-removal";
import { uploadProductToEbay } from "@/lib/ebay-upload";
import { clearPendingShippingChallenges, resolveShippingApproval, getUploadShippingApproval, readShippingConfirmation } from './amazon-upload-shipping';
import type { ShippingConfirmation, UploadShippingConfirmation } from './amazon-upload-shipping-policy';
import { partitionUploadProductIds } from "@/lib/ebay-upload-job-policy";
import { createEbayImageFromUrl } from "@/lib/ebay-media";
import {
  getConfiguredPublicImageBaseUrl,
  prepareEbayPictureUrls,
} from "@/lib/ebay-image-urls";
import {
  getPriceCheckAutoHoldReason,
  isAutoHoldPriceCheckFailureCode,
  isPriceCheckAutoHoldMetadata,
  isPriceCheckAutoResumeMetadata,
  isRecoveredPriceCheckAutoHold,
} from "@/lib/price-check-failures";
import { getMinimumProductQuantity, isAmazonStockLow, isLowStockHoldJobMetadata } from "@/lib/low-stock-products";
import { evaluateAmazonShipping, getCommittedShippingEvidence } from "./amazon-shipping-evidence";
import { resolveAmazonDeliveryPostcode } from "./amazon-delivery-postcode";
import { getPriceCheckRecoveryEvidence, priceCheckRecoveryRelations } from "@/lib/price-check-recovery-evidence";
import {
  captureHoldQuantities,
  getProductHoldOrigin,
} from "@/lib/product-hold-state";
import { recordListingOperation } from "@/lib/listing-operations";
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
  EbayActionJobStatus.CANCELLING,
];

type ProductFailure = {
  variationResults?: InventoryResult[];
  outcomeUncertain?: boolean;
  awaitingRestoration?: number;
  blockerCode?: string;
  retryEligible?: boolean;
  shippingConfirmation?: UploadShippingConfirmation;
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
  shippingConfirmation?: ShippingConfirmation;
  requestId?: string;
  itemPayload?: Prisma.InputJsonValue;
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
            ...(Array.isArray(record.variationResults)?{variationResults:record.variationResults as InventoryResult[]}:{}),
            ...(typeof record.outcomeUncertain==="boolean"?{outcomeUncertain:record.outcomeUncertain}:{}),
            ...(typeof record.retryEligible==="boolean"?{retryEligible:record.retryEligible}:{}),
            ...(readShippingConfirmation(record.shippingConfirmation) ? { shippingConfirmation: { ...readShippingConfirmation(record.shippingConfirmation)!, message: String(record.error ?? "") } } : {}),
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

function getPrimarySellPrice(product: Pick<BulkEditRevisionProduct, "variants">) {
  const primarySellPrice =
    product.variants.length > 0 ? Number(product.variants[0].sellPrice) : null;

  return primarySellPrice !== null &&
    Number.isFinite(primarySellPrice) &&
    primarySellPrice > 0
    ? primarySellPrice
    : undefined;
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
    errors: normalizeErrors(job.errors).map(error => {
      if (!error.shippingConfirmation) return error;
      const pending = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata) ? job.metadata.pendingShipping : null;
      const challenge = pending && typeof pending === "object" && !Array.isArray(pending) ? pending[error.productId] : null;
      if (challenge && typeof challenge === "object" && !Array.isArray(challenge) && !challenge.approvedJobId && challenge.nonce === error.shippingConfirmation.nonce) return error;
      const cleared = { ...error }; delete cleared.shippingConfirmation; return cleared;
    }),
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

export type PromotedAdsJobMetadata = {
  kind: "promoted-ads";
  operation: "APPLY" | "REMOVE";
  bidPercentage: number | null;
  campaignMode: "EXISTING" | "CREATE" | "DEPENDENT" | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignDependencyJobId: string | null;
};

export function getPromotedAdsMetadata(job: Pick<EbayActionJobRecord, "metadata">): PromotedAdsJobMetadata {
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
          : record.campaignMode === "DEPENDENT"
            ? "DEPENDENT"
          : null,
    campaignId:
      typeof record.campaignId === "string" && record.campaignId.trim()
        ? record.campaignId.trim()
        : null,
    campaignName:
      typeof record.campaignName === "string" && record.campaignName.trim()
        ? record.campaignName.trim()
        : null,
    campaignDependencyJobId:
      typeof record.campaignDependencyJobId === "string" && record.campaignDependencyJobId.trim()
        ? record.campaignDependencyJobId.trim()
        : null,
  };
}

/**
 * Find the most recent queued or running campaign-creation job for a name.
 * A dependent promotion can safely wait for this job to write its campaign ID;
 * if it never does, the dependent job reports that failure instead of creating
 * a second campaign.
 */
export async function findPromotedCampaignDependency(
  storeId: string,
  campaignName: string,
) {
  const normalizedName = campaignName.trim().toLocaleLowerCase();
  if (!normalizedName) return null;

  const jobs = await prisma.ebayActionJob.findMany({
    where: {
      storeId,
      type: EbayActionJobType.MANAGE_PROMOTED_ADS,
      dismissedAt: null,
      status: { in: [EbayActionJobStatus.QUEUED, EbayActionJobStatus.RUNNING] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });

  for (const candidate of jobs) {
    const metadata = getPromotedAdsMetadata(candidate);
    if (
      metadata.operation === "APPLY" &&
      (metadata.campaignMode === "CREATE" || metadata.campaignMode === "DEPENDENT") &&
      metadata.campaignName?.trim().toLocaleLowerCase() === normalizedName
    ) {
      return metadata.campaignMode === "DEPENDENT"
        ? metadata.campaignDependencyJobId ?? candidate.id
        : candidate.id;
    }
  }

  return null;
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
  for (const productIds of chunkInventoryReviseItems(remainingIds, 20)) {
    if (await isEbayActionCancellationRequested(job.id)) return;
    await runPromotedAdsBatch(job, productIds);
  }
}

async function runPromotedAdsBatch(job: EbayActionJobRecord, remainingIds: string[]) {
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

    if (await isEbayActionCancellationRequested(job.id)) return;

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

    if (await isEbayActionCancellationRequested(job.id)) return;

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
        if (await isEbayActionCancellationRequested(job.id)) return;
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

    if (metadata.campaignMode === "CREATE" && !targetCampaignId) {
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
    } else if (metadata.campaignMode === "DEPENDENT") {
      const dependencyId = metadata.campaignDependencyJobId;
      const dependency = dependencyId
        ? await prisma.ebayActionJob.findUnique({ where: { id: dependencyId } })
        : null;
      const dependencyMetadata = dependency
        ? getPromotedAdsMetadata(dependency)
        : null;
      targetCampaignId = dependencyMetadata?.campaignId ?? null;
      targetCampaignName = dependencyMetadata?.campaignName ?? targetCampaignName;
      if (!targetCampaignId) {
        throw new Error(
          `The earlier promotion job could not create campaign ${JSON.stringify(
            metadata.campaignName ?? "",
          )}; this queued job was not applied.`,
        );
      }

      const campaign = await getEbayGeneralCampaign(storeNumber, targetCampaignId);
      if (!campaign || !campaign.supported || campaign.rateStrategy !== "FIXED") {
        throw new Error("The dependent eBay campaign is unavailable or is not fixed-rate.");
      }
      targetCampaignName = campaign.campaignName;
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

    if (await isEbayActionCancellationRequested(job.id)) return;

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

    if (await isEbayActionCancellationRequested(job.id)) return;

    // Once a move starts, finish this bounded batch (including any rollback)
    // before honoring cancellation so listings are not left between campaigns.
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
    if (await isEbayActionCancellationRequested(job.id)) return;
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

  const updatedJob = await prisma.$transaction(async tx => {
    const fresh=await tx.ebayActionJob.findUnique({where:{id:job.id}});
    if(!fresh)throw new Error("Job no longer exists.");
    Object.assign(job,fresh);
  const completed = new Set(job.completedProductIds);
  const errors = normalizeErrors(job.errors);
  let succeededCount = 0;
  let failedCount = 0;

  for (const update of updates) {
    if (completed.has(update.productId)) continue;
    if (job.type === EbayActionJobType.BULK_EDIT_REVISE && update.failure?.awaitingRestoration) {
      const durable = await tx.bulkEditJobItem.findUnique({ where: { jobId_productId: { jobId: job.id, productId: update.productId } } });
      if (durable?.status === "SUCCEEDED") { update.succeeded = true; update.failure = null; }
    }
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

  const claimed = await tx.ebayActionJob.updateMany({
    where: { id: job.id,processed:fresh.processed,succeeded:fresh.succeeded,failed:fresh.failed },
    data: {
      completedProductIds: { set: job.productIds.filter((id) => completed.has(id)) },
      processed: completed.size,
      succeeded: job.succeeded + succeededCount,
      failed: job.failed + failedCount,
      errors: errors as unknown as Prisma.InputJsonValue,
    },
  });

  if(!claimed.count)throw new Error("Job progress changed; confirmed inventory checkpoints are preserved.");
  return tx.ebayActionJob.findUnique({where:{id:job.id}});
  });
  Object.assign(job,updatedJob);
}

async function processVariationBulkProduct(job:EbayActionJobRecord,productId:string,worker?:WorkerContext) {
 try {
  const result=await executeBulkInventoryEdit({jobId:job.id,productId,storeId:job.storeId,fields:getBulkEditFields(job),assertCurrent:async()=>{
   await assertEbayActionLeaseOwned(job,worker);
   if(await isEbayActionCancellationRequested(job.id))throw new Error("Bulk edit cancelled. Confirmed variations are preserved.");
  }});
  return {ok:result.success,failure:result.success?null:{productId,title:(await prisma.product.findUnique({where:{id:productId},select:{title:true}}))?.title??"(missing)",
   error:result.errorMessage??"Update failed.",variationResults:result.variationResults,outcomeUncertain:result.outcomeUncertain,retryEligible:result.retryEligible,awaitingRestoration:result.awaitingRestoration}};
 }catch(error){
  const message=error instanceof Error?error.message:"Bulk edit failed.";
  const saved=await prisma.listingOperation.findUnique({where:{requestKey:"inventory:bulk:"+job.id+":"+productId}}).catch(()=>null);
  const plan=saved?.preparedPayload as unknown as InventoryPlan|undefined;
  const checkpoint=plan?.kind==="ebay-inventory"&&[1,2].includes(plan.version)?inventorySummary(plan):undefined;
  await prisma.bulkEditJobItem.updateMany({where:{jobId:job.id,productId},data:{status:"FAILED",error:message,completedAt:new Date()}});
  return {ok:false,failure:{productId,title:(await prisma.product.findUnique({where:{id:productId},select:{title:true}}))?.title??"(missing)",error:message,...(checkpoint?{variationResults:checkpoint.variationResults,outcomeUncertain:checkpoint.outcomeUncertain,awaitingRestoration:checkpoint.awaitingRestoration}:{}),blockerCode:error instanceof InventoryBlocker?error.code:undefined,retryEligible:error instanceof InventoryBlocker?false:!(/ended|SKU|currency|Legacy|Unsupported/i.test(message))}};
 }
}

async function processProduct(job: EbayActionJobRecord, productId: string, worker?:WorkerContext) {
  if(job.type===EbayActionJobType.BULK_EDIT_REVISE&&!getBulkEditFields(job).has("sku")) return processVariationBulkProduct(job,productId,worker);
  const assertActionCurrent=async()=>{await assertEbayActionLeaseOwned(job,worker);if(worker&&await isEbayActionCancellationRequested(job.id))throw new Error("Listing update cancelled.");};
  const automaticPriceCheckHold =
    job.type === EbayActionJobType.HOLD &&
    isPriceCheckAutoHoldMetadata(job.metadata);
  const automaticShippingHold = job.type === EbayActionJobType.HOLD && Boolean(job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata) && job.metadata.kind === 'amazon-shipping-hold');
  const automaticLowStockHold =
    job.type === EbayActionJobType.HOLD &&
    isLowStockHoldJobMetadata(job.metadata);
  const automaticPriceCheckResume =
    job.type === EbayActionJobType.RESUME &&
    isPriceCheckAutoResumeMetadata(job.metadata);
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: job.storeId },
    include: {
      store: true,
      variants: {
        orderBy: { createdAt: "asc" },
      },
      ...(job.type === EbayActionJobType.RESUME || automaticPriceCheckHold || automaticLowStockHold || automaticShippingHold
        ? priceCheckRecoveryRelations : {}),
    },
  });

  if (!product) {
    if (automaticPriceCheckHold || automaticPriceCheckResume || automaticShippingHold) {
      return { ok: true, failure: null };
    }

    return {
      ok: false,
      failure: { productId, title: "(missing)", error: "Product was not found" },
    };
  }

  const automaticObservationIsCurrent = async () => {
    if (!(automaticPriceCheckHold || automaticLowStockHold || automaticPriceCheckResume || automaticShippingHold) ||
        !product.lastPriceCheck) return true;
    try {
      await assertAmazonObservationCurrent({ storeId: product.storeId, productId,
        observedAt: product.lastPriceCheck });
      if (automaticShippingHold || automaticPriceCheckResume) {
        const [currentSettings, currentProduct] = await Promise.all([
          prisma.supplierSettings.findUnique({ where: { storeId_supplierName: { storeId: product.storeId, supplierName: "Amazon AU" } }, select: { minProductQuantity: true, maxShippingDays: true, scrapePostcode: true } }),
          prisma.product.findFirst({ where: { id: productId, storeId: product.storeId }, include: { ...priceCheckRecoveryRelations, variants: { orderBy: { createdAt: "asc" } } } }),
        ]);
        if (!currentProduct || currentProduct.ebayItemId !== product.ebayItemId || currentProduct.holdLastObservationId !== product.holdLastObservationId) return false;
        if (automaticShippingHold && (currentProduct.status !== ProductStatus.IMPORTED || currentProduct.holdOrigin === ProductHoldOrigin.MANUAL)) return false;
        const settings = currentSettings ?? { minProductQuantity: 2, maxShippingDays: 25, scrapePostcode: "2217" };
        const currentEvidence = getCommittedShippingEvidence(currentProduct, currentProduct.amazonPriceObservations.find(row => row.id === currentProduct.holdLastObservationId), resolveAmazonDeliveryPostcode(settings.scrapePostcode));
        const shipping = evaluateAmazonShipping(currentEvidence, settings.maxShippingDays, new Date(), true);
        if (shipping.outcome !== (automaticShippingHold ? "OVER_LIMIT" : "WITHIN_LIMIT")) return false;
        if (automaticPriceCheckResume && !isRecoveredPriceCheckAutoHold({ ...currentProduct,
          ...getPriceCheckRecoveryEvidence(currentProduct, settings), minimumProductQuantity: getMinimumProductQuantity(settings.minProductQuantity) })) return false;
      }
      return true;
    } catch (error) {
      if (error instanceof SupersededAmazonObservation) return false;
      throw error;
    }
  };

  if (job.type === EbayActionJobType.UPLOAD_LISTING) {
    const result = await uploadProductToEbay({
      productId,
      storeId: job.storeId,
      userId: job.userId,
      log: logger,
      jobId: job.id,
      shippingApproval: getUploadShippingApproval(job.metadata, productId),
    });

    return result.ok
      ? { ok: true, failure: null }
      : {
          ok: false,
          failure: {
            productId,
            title: result.productTitle || product.title,
            error: result.body.error || "Upload failed.",
            shippingConfirmation: result.body.shippingConfirmation,
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
        data: { itemSpecifics },
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
      const snapshot=await readEbayInventory(product.ebayItemId!,storeNumber);
      const requests=product.variants.length?product.variants.map(v=>({variantId:v.id,price:Number(v.sellPrice),
        ...(quantityChanged?{quantity:v.quantity}:{})})):[{price:Number(product.price),...(quantityChanged?{quantity:product.quantity}:{})}];
      const result=await writeEbayInventory({productId,storeId:product.storeId,requestKey:"inventory:listing:"+job.id+":"+productId,snapshot,requests,assertCurrent:assertActionCurrent,
        listingStep:{state:"PENDING",patch:{images:preparedImages,shippingPolicyId:policySelection.shippingPolicyId,returnPolicyId:policySelection.returnPolicyId,paymentPolicyId:policySelection.paymentPolicyId,policyTemplateId:policySelection.policyTemplateId},
          xml:buildReviseItemXML({...productWithPolicies,description:finalDescription,images:preparedImages},undefined,{
            includeStartPrice:false,includeQuantity:false,includePictures:true,includeItemSpecifics:true,includeShippingPackage:true
          })}
      });

      if (!result.success) {
        const errorMessage = result.errorMessage || "eBay listing update failed";
        if(!product.errorMessage && !result.awaitingRestoration)await prisma.product.update({where:{id:product.id},data:{errorMessage}});
        return {
          ok: false,
          failure: { productId, title: product.title, error: errorMessage, variationResults:result.variationResults,outcomeUncertain:result.outcomeUncertain,retryEligible:result.retryEligible,awaitingRestoration:result.awaitingRestoration },
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
      if(!product.errorMessage)await prisma.product.update({where:{id:product.id},data:{errorMessage}});
      return {
        ok: false,
        failure: { productId, title: product.title, error: errorMessage,blockerCode:error instanceof InventoryBlocker?error.code:undefined,retryEligible:error instanceof InventoryBlocker?false:!/ended|SKU|currency|context changed/i.test(errorMessage) },
      };
    }
  }

  if (job.type === EbayActionJobType.HOLD) {
    if(product.status===ProductStatus.ON_HOLD&&product.holdSourceJobId===job.id){const completed=await prisma.listingOperation.findUnique({where:{requestKey:"inventory:hold:"+job.id+":"+productId}});if(completed?.stage==="COMPLETED")return {ok:true,failure:null};}
    if (!await automaticObservationIsCurrent()) return { ok: true, failure: null };

    const settings = await prisma.supplierSettings.findUnique({
      where: { storeId_supplierName: { storeId: product.storeId, supplierName: "Amazon AU" } },
      select: { minProductQuantity: true, autoHoldOnPriceCheckFailure: true, maxShippingDays: true, scrapePostcode: true },
    });
    const minimum = getMinimumProductQuantity(settings?.minProductQuantity);
    const shipping = evaluateAmazonShipping(getCommittedShippingEvidence(product, product.amazonPriceObservations?.find(row => row.id === product.holdLastObservationId), resolveAmazonDeliveryPostcode(settings?.scrapePostcode)), settings?.maxShippingDays ?? 25, new Date(), true);
    if (automaticShippingHold && (product.status !== ProductStatus.IMPORTED || product.holdOrigin === ProductHoldOrigin.MANUAL || shipping.outcome !== 'OVER_LIMIT')) return { ok: true, failure: null };
    const verifiedStockLeft = automaticPriceCheckHold || automaticLowStockHold
      ? getPriceCheckRecoveryEvidence(product).verifiedStockLeft : null;
    if (automaticLowStockHold &&
        (product.status !== ProductStatus.IMPORTED ||
          !isAmazonStockLow(verifiedStockLeft, minimum))) {
      return { ok: true, failure: null };
    }
    const failureHold = Boolean(product.priceCheckError) &&
      isAutoHoldPriceCheckFailureCode(product.priceCheckFailureCode) &&
      ((settings?.autoHoldOnPriceCheckFailure ?? true) ||
        product.priceCheckFailureCode === PriceCheckFailureCode.AMAZON_ASIN_REDIRECT ||
        product.priceCheckFailureCode === PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE);
    const priceCheckLowStockHold = automaticPriceCheckHold &&
      product.priceCheckFailureCode !== PriceCheckFailureCode.TECHNICAL_ERROR &&
      isAmazonStockLow(verifiedStockLeft, minimum);
    if (automaticPriceCheckHold &&
        (product.status !== ProductStatus.IMPORTED || (!failureHold && !priceCheckLowStockHold))) {
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

    // Preserve the restoration quantity before the remote zero-quantity write.
    // Repeated holds keep the first snapshot rather than overwriting it with 0.
    const saved = captureHoldQuantities({
      currentQuantity: product.quantity,
      existingSavedQuantity: product.holdSavedQuantity,
      existingSavedVariants: product.holdSavedVariantQuantities,
      variants: product.variants,
    });
    if (product.holdSavedQuantity === null || product.holdSavedQuantity === undefined) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          holdSavedQuantity: saved.savedQuantity,
          holdSavedVariantQuantities: saved.savedVariants,
          holdSourceJobId: job.id,
        },
      });
    }

    if (!await automaticObservationIsCurrent()) return { ok: true, failure: null };
    let result;
    try { result = await writeEbayInventory({productId,storeId:product.storeId,requestKey:"inventory:hold:"+job.id+":"+productId,
      requests:[{quantity:0}],allRemote:true,assertCurrent:async()=>{await assertActionCurrent();if(!await automaticObservationIsCurrent())throw new Error("Hold evidence changed.");}
    }); }catch(error){
      if(error instanceof Error&&error.message==="Hold evidence changed.")return {ok:true,failure:null};
      return {ok:false,failure:{productId,title:product.title,error:error instanceof Error?error.message:"Hold failed."}};
    }

    if (!result.success) {
      await recordListingOperation({
        jobId: job.id,
        productId,
        storeId: job.storeId,
        stage: "FAILED",
        error: result.errorMessage || "Unknown eBay API error",
      }).catch(() => undefined);
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: result.errorMessage || "Unknown eBay API error",
        },
      };
    }

    let holdReason = product.quantity <= 0
      ? "Listing quantity was set to 0."
      : "Put on hold manually.";
    if (automaticShippingHold) {
      holdReason = shipping.message;
    } else if (priceCheckLowStockHold) {
      holdReason = `Low Amazon stock (${verifiedStockLeft} left; minimum ${minimum}).`;
    } else if (automaticLowStockHold) {
      holdReason = `Low Amazon stock (${verifiedStockLeft} left; minimum ${minimum}).`;
    } else if (automaticPriceCheckHold && failureHold) {
      holdReason = getPriceCheckAutoHoldReason(product.priceCheckError);
    }

    const holdOrigin = automaticShippingHold ? ProductHoldOrigin.AMAZON_SHIPPING_DELAY : getProductHoldOrigin({
      automaticPriceCheck: automaticPriceCheckHold && failureHold && !priceCheckLowStockHold,
      lowStock: automaticLowStockHold || priceCheckLowStockHold,
      failureCode: product.priceCheckFailureCode,
      existing: product.holdOrigin,
    });

    await assertActionCurrent();
    await prisma.$transaction(async (tx) => {
      const changed=await tx.product.updateMany({
        where: { id: product.id,storeId:job.storeId,holdGeneration:product.holdGeneration,status:product.status,ebayItemId:product.ebayItemId },
        data: {
          status: ProductStatus.ON_HOLD,
          quantity: 0,
          holdReason,
          holdOrigin,
          holdGeneration: { increment: 1 },
          holdSavedQuantity: saved.savedQuantity,
          holdSavedVariantQuantities: saved.savedVariants,
          holdSourceJobId: job.id,

        },
      });
      if(!changed.count)throw new Error("Hold context changed after marketplace confirmation.");
    });
    await recordListingOperation({
      jobId: job.id,
      productId,
      storeId: job.storeId,
      stage: "COMPLETED",
      holdGeneration: product.holdGeneration + 1,
      targetQuantities: { product: 0 },
      preparedPayload: { kind: "hold", origin: holdOrigin },
      confirmed: true,
    }).catch(() => undefined);
    return { ok: true, failure: null };
  }

  if (job.type === EbayActionJobType.RESUME) {
    if(product.status===ProductStatus.IMPORTED){const completed=await prisma.listingOperation.findUnique({where:{requestKey:"inventory:resume:"+job.id+":"+productId}});if(completed?.stage==="COMPLETED")return {ok:true,failure:null};}
    if (!await automaticObservationIsCurrent()) return { ok: true, failure: null };
    if (automaticPriceCheckResume) {
      const settings = await prisma.supplierSettings.findUnique({
        where: { storeId_supplierName: { storeId: product.storeId, supplierName: "Amazon AU" } },
        select: { minProductQuantity: true, maxShippingDays: true, scrapePostcode: true },
      });
      if (!isRecoveredPriceCheckAutoHold({
        ...product,
        ...getPriceCheckRecoveryEvidence(product, settings ?? { maxShippingDays: 25, scrapePostcode: "2217" }),
        minimumProductQuantity: getMinimumProductQuantity(settings?.minProductQuantity),
      })) return { ok: true, failure: null };
    }

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

    const resumeSettings = await prisma.supplierSettings.findUnique({ where: { storeId_supplierName: { storeId: product.storeId, supplierName: "Amazon AU" } }, select: { minProductQuantity: true, maxShippingDays: true, scrapePostcode: true } });
    const previousResume = await prisma.listingOperation.findUnique({ where: { requestKey: "inventory:resume:" + job.id + ":" + productId } });
    const previousPlan = previousResume?.preparedPayload as unknown as InventoryPlan | undefined;
    const previousIntent = previousPlan?.kind === "ebay-inventory" ? JSON.parse(String(previousPlan.context.intent)) as { requests: InventoryRequest[] } : undefined;
    const deferred = resolveDeferredPricing(product, resumeSettings ?? undefined);
    if (deferred.error || product._count.priceHistory > deferred.coveredHistoryIds.length)
      return { ok: false, failure: { productId, title: product.title, error: deferred.error ?? "Price review required before restoration.", retryEligible: false } };
    if (deferred.sources.length) {
      if (!product.holdOrigin || product.holdOrigin === ProductHoldOrigin.UNKNOWN || product.holdOrigin === ProductHoldOrigin.PRICE_CHECK_UNSAFE_PRICE)
        return { ok: false, failure: { productId, title: product.title, error: "This hold requires review before stock can be restored.", retryEligible: false } };
      const evidence = getPriceCheckRecoveryEvidence(product, resumeSettings ?? { maxShippingDays: 25, scrapePostcode: "2217" });
      if (product.priceCheckError || product.priceCheckFailureCode || product.amazonAvailability !== "IN_STOCK" ||
          evidence.identityOutcome !== "MATCH" || evidence.buyBoxOutcome !== "AVAILABLE" || !evidence.postcodeVerified ||
          evidence.hasUnappliedPriceChange || !evidence.shippingWithinLimit || evidence.verifiedStockLeft == null || isAmazonStockLow(evidence.verifiedStockLeft, getMinimumProductQuantity(resumeSettings?.minProductQuantity)))
        return { ok: false, failure: { productId, title: product.title, error: "Fresh verified price, stock and delivery are required before the deferred price can be restored.", retryEligible: false } };
    }
    // Manual and automatic restores always start at one, regardless of the
    // pre-hold snapshot. Older holds do not need a quantity snapshot to recover.
    const restoreQty = 1;
    if (!await automaticObservationIsCurrent()) return { ok: true, failure: null };
    let result;
    try { result=await writeEbayInventory({productId,storeId:product.storeId,requestKey:"inventory:resume:"+job.id+":"+productId,
      requests:previousIntent?.requests ?? (product.variants.length?product.variants.map(v=>deferred.requests.find(r=>r.variantId===v.id)??({variantId:v.id,quantity:restoreQty})):[{quantity:restoreQty}]), deferredSources: deferred.sources,
      automaticRecovery:automaticPriceCheckResume,assertCurrent:async()=>{await assertActionCurrent();if(!await automaticObservationIsCurrent())throw new Error("Recovery evidence changed.");}
    }); }catch(error){
      const message=error instanceof Error?error.message:"Resume failed.";
      if(message==="These variations need verification before stock can be restored.") await prisma.product.update({where:{id:productId},data:{holdReason:message}});
      return {ok:false,failure:{productId,title:product.title,error:message,retryEligible:false}};
    }

    if (!result.success) {
      await recordListingOperation({
        jobId: job.id,
        productId,
        storeId: job.storeId,
        stage: "FAILED",
        targetQuantities: { product: restoreQty },
        error: result.errorMessage || "Unknown eBay API error",
      }).catch(() => undefined);
      return {
        ok: false,
        failure: {
          productId,
          title: product.title,
          error: result.errorMessage || "Unknown eBay API error",
        },
      };
    }

    await assertActionCurrent();
    await prisma.$transaction(async (tx) => {
      const changed=await tx.product.updateMany({
        where: { id: product.id,storeId:job.storeId,holdGeneration:product.holdGeneration,status:product.status,ebayItemId:product.ebayItemId },
        data: {
          status: ProductStatus.IMPORTED,
          quantity: restoreQty,
          holdReason: null,
          holdOrigin: null,
          holdSavedQuantity: null,
          holdSavedVariantQuantities: Prisma.JsonNull,
          holdSourceJobId: null,
        },
      });
      if(!changed.count)throw new Error("Recovery context changed after marketplace confirmation.");
      await tx.variant.updateMany({
        where: { productId: product.id },
        data: { quantity: restoreQty },
      });
    });
    await recordListingOperation({
      jobId: job.id,
      productId,
      storeId: job.storeId,
      stage: "COMPLETED",
      targetQuantities: { product: restoreQty },
      preparedPayload: { kind: "resume", automatic: automaticPriceCheckResume },
      confirmed: true,
    }).catch(() => undefined);
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
      try {
        const skuSnapshot = await readEbayInventory(product.ebayItemId, storeNumber);
        assertDistinctParentSku(skuSnapshot, customLabel);
        // Existing variation identifiers are not parent-label fill values.
        if (skuSnapshot.variation) throw new InventoryBlocker("VARIATION_PARENT_LABEL_REVIEW", "Parent labels on variation listings require an explicit reviewed label edit.");
      } catch (error) {
        return { ok: false, failure: { productId, title: product.title, error: error instanceof Error ? error.message : "Parent label validation failed.", retryEligible: false, blockerCode: error instanceof InventoryBlocker ? error.code : undefined } };
      }
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
          ...(revisedImages ? { images: revisedImages } : {}),
        },
      });
      return { ok: true, failure: null };
    }

    return {ok:false,failure:{productId,title:product.title,error:"SKU changes cannot be combined with inventory changes."}};
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

async function assertEbayActionLeaseOwned(
  job: EbayActionJobRecord,
  worker?: WorkerContext,
) {
  if (!worker) return;
  const owned = await prisma.jobLease.count({
    where: {
      storeId: job.storeId,
      jobType: "EBAY_ACTION",
      jobId: job.id,
      workerId: worker.workerId,
      expiresAt: { gt: new Date() },
    },
  });
  if (owned === 0) {
    throw new JobConflictError("Worker lost ownership of the bulk-edit job.");
  }
}

async function runEbayActionJobClaimed(jobId: string, worker?: WorkerContext) {
  const job = await prisma.ebayActionJob.findUnique({ where: { id: jobId } });

  if (!job || !ACTIVE_ACTION_JOB_STATUSES.includes(job.status)) {
    return;
  }

  const claimed = await prisma.ebayActionJob.updateMany({
    where: {
      id: job.id,
      status: { in: [EbayActionJobStatus.QUEUED, EbayActionJobStatus.RUNNING] },
    },
    data: {
      status: EbayActionJobStatus.RUNNING,
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
    },
  });
  if (claimed.count === 0) {
    await finishEbayActionCancellation(job.id);
    invalidateJobCaches(job.storeId);
    return;
  }
  Object.assign(job, { status: EbayActionJobStatus.RUNNING });

  if (job.type === EbayActionJobType.MANAGE_PROMOTED_ADS) {
    await runPromotedAdsJob(job);
  } else if (job.type === EbayActionJobType.BULK_EDIT_REVISE && !getBulkEditFields(job).has("sku")) {
    const completed=new Set(job.completedProductIds);
    for(const productId of job.productIds.filter(id=>!completed.has(id))){
      if(await isEbayActionCancellationRequested(job.id))break;
      await assertEbayActionLeaseOwned(job,worker);
      const result=await processVariationBulkProduct(job,productId,worker);
      await assertEbayActionLeaseOwned(job,worker);
      await markProgress(job,productId,result.ok,result.failure);
    }
  } else {
    const completed = new Set(job.completedProductIds);
    const remaining = job.productIds.filter((productId) => !completed.has(productId));

    for (const productId of remaining) {
      if (await isEbayActionCancellationRequested(job.id)) break;
      try {
        await assertEbayActionLeaseOwned(job, worker);
        const result = await processProduct(job, productId,worker);
        await assertEbayActionLeaseOwned(job, worker);
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

  await prisma.ebayActionJob.updateMany({
    where: { id: job.id, status: EbayActionJobStatus.RUNNING },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      errorMessage:
        finalStatus === EbayActionJobStatus.FAILED
          ? `${actionLabel(job.type)} failed for all products.`
          : null,
    },
  });

  await finishEbayActionCancellation(job.id);

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
    () => runEbayActionJobClaimed(job.id, worker)
  );
}

export async function createEbayActionJob(input: CreateEbayActionJobInput) {
  const productIds = normalizeProductIds(input.productIds);

  if (input.requestId) {
    const existing = await prisma.ebayActionJob.findFirst({
      where: { storeId: input.storeId, requestId: input.requestId },
    });
    if (existing) {
      return { job: serializeEbayActionJob(existing), queued: existing.total > 0 };
    }
  }

  if (
    input.type === EbayActionJobType.UPLOAD_LISTING &&
    productIds.length > 0
  ) {
    return createOrReuseEbayUploadJob({ ...input, productIds });
  }

  let job: EbayActionJobRecord;
  try {
    const data = {
      userId: input.userId,
      storeId: input.storeId,
      type: input.type,
      status: productIds.length > 0 ? EbayActionJobStatus.QUEUED : EbayActionJobStatus.COMPLETED,
      productIds,
      total: productIds.length,
      metadata: input.metadata ?? {},
      requestId: input.requestId,
      completedAt: productIds.length > 0 ? null : new Date(),
    };
    job = input.type === EbayActionJobType.BULK_EDIT_REVISE && input.itemPayload
      ? await createBulkEditJobWithItems(prisma, data, productIds, input.itemPayload)
      : await prisma.ebayActionJob.create({ data });
  } catch (error) {
    if (
      input.requestId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.ebayActionJob.findFirst({
        where: { storeId: input.storeId, requestId: input.requestId },
      });
      if (existing) {
        return { job: serializeEbayActionJob(existing), queued: existing.total > 0 };
      }
    }
    throw error;
  }

  return { job: serializeEbayActionJob(job), queued: productIds.length > 0 };
}

export async function createOrReuseEbayUploadJob(
  input: Omit<CreateEbayActionJobInput, "type">,
) {
  const productIds = normalizeProductIds(input.productIds).sort();

  return prisma.$transaction(async (tx) => {
    const lockedProducts: Array<{ id: string }> = [];

    // Serialize upload creation per product. This closes the race between two
    // browser requests that both check for an active job before either creates it.
    for (const productId of productIds) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Product"
        WHERE "id" = ${productId} AND "storeId" = ${input.storeId}
        FOR UPDATE
      `;
      lockedProducts.push(...rows);
    }

    const approval = input.shippingConfirmation ? await resolveShippingApproval(tx, input.storeId, productIds, input.shippingConfirmation) : null;
    if (approval?.existingJobId) {
      const existing = await tx.ebayActionJob.findFirstOrThrow({ where: { id: approval.existingJobId, storeId: input.storeId } });
      return { job: serializeEbayActionJob(existing), queued: true, created: false, reused: true, activeProductIds: existing.productIds };
    }
    const lockedProductIds = new Set(lockedProducts.map((product) => product.id));
    const validProductIds = productIds.filter((productId) =>
      lockedProductIds.has(productId),
    );
    const activeJobs = await tx.ebayActionJob.findMany({
      where: {
        storeId: input.storeId,
        type: EbayActionJobType.UPLOAD_LISTING,
        status: { in: ACTIVE_ACTION_JOB_STATUSES },
        dismissedAt: null,
        productIds: { hasSome: validProductIds },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const { activeProductIds, queueProductIds } = partitionUploadProductIds({
      requestedProductIds: validProductIds,
      alreadyListedProductIds: [],
      activeJobs,
    });

    if (queueProductIds.length > 0) {
      const job = await tx.ebayActionJob.create({
        data: {
          userId: input.userId,
          storeId: input.storeId,
          type: EbayActionJobType.UPLOAD_LISTING,
          status: EbayActionJobStatus.QUEUED,
          productIds: queueProductIds,
          total: queueProductIds.length,
          metadata: approval ? { shippingApprovals: { [productIds[0]]: approval.approvedContext } } : input.metadata ?? {},
        },
      });
      await clearPendingShippingChallenges(tx, input.storeId, queueProductIds, approval?.source.id);
      if (approval && input.shippingConfirmation) {
        const previous = approval.source.metadata && typeof approval.source.metadata === 'object' && !Array.isArray(approval.source.metadata) ? approval.source.metadata : {};
        const pending = previous.pendingShipping && typeof previous.pendingShipping === 'object' && !Array.isArray(previous.pendingShipping) ? previous.pendingShipping : {};
        await tx.ebayActionJob.update({ where: { id: approval.source.id }, data: { metadata: { ...previous,
          hasPendingShipping: Object.entries(pending).some(([id, value]) => id !== productIds[0] && value && typeof value === "object" && !Array.isArray(value) && !value.approvedJobId),
          pendingShipping: { ...pending, [productIds[0]]: { nonce: input.shippingConfirmation.nonce, context: approval.approvedContext, approvedJobId: job.id } } } } });
      }
      return {
        job: serializeEbayActionJob(job),
        queued: true,
        created: true,
        reused: activeProductIds.length > 0,
        activeProductIds,
      };
    }

    const existingJob = activeJobs.find((job) =>
      job.productIds.some((productId) => activeProductIds.includes(productId)),
    );

    if (!existingJob) {
      throw new Error("No valid products were found for the eBay upload.");
    }

    return {
      job: serializeEbayActionJob(existingJob),
      queued: true,
      created: false,
      reused: true,
      activeProductIds,
    };
  });
}

export async function getCurrentEbayActionJobs(storeId: string) {
  const [activeJobs, recentTerminalJobs, confirmationJobs] = await Promise.all([
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
    prisma.ebayActionJob.findMany({
      where: { storeId, type: EbayActionJobType.UPLOAD_LISTING, metadata: { path: ["hasPendingShipping"], equals: true } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const jobs = [...new Map([...activeJobs, ...recentTerminalJobs, ...confirmationJobs].map(job => [job.id, job])).values()];
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
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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

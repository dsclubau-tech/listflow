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
  buildReviseItemXML,
  buildReviseQuantityXML,
} from "@/lib/ebay-xml";
import {
  callEbayEndItem,
  callEbayReviseInventoryStatus,
  callEbayReviseItem,
  getStoreNumber,
} from "@/lib/ebay";
import {
  assertNoEbayLaneStartConflict,
  getEbayWriteLeaseInput,
  JobConflictError,
  withJobLeases,
  type WorkerContext,
} from "@/lib/job-coordination";
import { logger } from "@/lib/logger";
import { policyIdsMatch, resolveProductPolicySelection } from "@/lib/policy-defaults";
import { prisma } from "@/lib/prisma";
import { invalidateJobCaches, invalidateProductCaches } from "@/lib/cache-tags";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { deleteProductFromListflow } from "@/lib/product-removal";

const ACTIVE_ACTION_JOB_STATUSES: EbayActionJobStatus[] = [
  EbayActionJobStatus.QUEUED,
  EbayActionJobStatus.RUNNING,
];

type ProductFailure = {
  productId: string;
  title: string;
  error: string;
};

type EbayActionJobRecord = {
  id: string;
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

function actionLabel(type: EbayActionJobType) {
  if (type === EbayActionJobType.HOLD) return "Put listings on hold";
  if (type === EbayActionJobType.RESUME) return "Resume listings";
  if (type === EbayActionJobType.BULK_EDIT_REVISE) return "Bulk edit listings";
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
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
  };
}

async function markProgress(
  job: EbayActionJobRecord,
  productId: string,
  succeeded: boolean,
  failure: ProductFailure | null
) {
  const completed = new Set(job.completedProductIds);
  completed.add(productId);
  const errors = normalizeErrors(job.errors);

  if (failure) {
    errors.push(failure);
  }

  const updated = await prisma.ebayActionJob.update({
    where: { id: job.id },
    data: {
      completedProductIds: { set: job.productIds.filter((id) => completed.has(id)) },
      processed: Math.min(job.total, job.processed + 1),
      succeeded: succeeded ? job.succeeded + 1 : job.succeeded,
      failed: succeeded ? job.failed : job.failed + 1,
      errors: errors as unknown as Prisma.InputJsonValue,
    },
  });

  Object.assign(job, updated);
}

async function processProduct(job: EbayActionJobRecord, productId: string) {
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
    return {
      ok: false,
      failure: { productId, title: "(missing)", error: "Product was not found" },
    };
  }

  if (job.type === EbayActionJobType.HOLD) {
    if (product.status !== ProductStatus.IMPORTED || !product.ebayItemId) {
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

    await prisma.product.update({
      where: { id: product.id },
      data: { status: ProductStatus.ON_HOLD, priceCheckError: null },
    });
    return { ok: true, failure: null };
  }

  if (job.type === EbayActionJobType.RESUME) {
    if (product.status !== ProductStatus.ON_HOLD || !product.ebayItemId) {
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
      data: { status: ProductStatus.IMPORTED },
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

    const bulkEditFields = getBulkEditFields(job);
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
    const primarySellPrice =
      product.variants.length > 0 ? Number(product.variants[0].sellPrice) : null;
    const overrideStartPrice =
      primarySellPrice !== null && Number.isFinite(primarySellPrice) && primarySellPrice > 0
        ? primarySellPrice
        : undefined;
    const storeNumber = await getStoreNumber(product.storeId);
    let result: { success: boolean; errorMessage?: string };
    const holdFromQuantity = quantityChanged && product.quantity <= 0;

    if (bulkEditFields.size === 0 || hasOnlyInventoryFields(bulkEditFields)) {
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

      if (result.success && holdFromQuantity) {
        result = await callEbayReviseInventoryStatus(
          buildReviseInventoryStatusXML(product.ebayItemId, {
            quantity: 0,
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

    await prisma.product.update({
      where: { id: product.id },
      data: {
        status: product.status,
        errorMessage: null,
        priceCheckError: null,
        ...(overrideStartPrice !== undefined ? { price: overrideStartPrice } : {}),
      },
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
      actionLabel(job.type)
    ),
    () => runEbayActionJobClaimed(job.id)
  );
}

export async function createEbayActionJob(input: CreateEbayActionJobInput) {
  const productIds = normalizeProductIds(input.productIds);

  if (productIds.length > 0) {
    await assertNoEbayLaneStartConflict(input.storeId, "write");
  }

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
  const jobs = await prisma.ebayActionJob.findMany({
    where: { storeId, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return jobs.map(serializeEbayActionJob);
}

export async function runNextEbayActionJobForStore(
  storeId: string,
  worker?: WorkerContext
) {
  const job = await prisma.ebayActionJob.findFirst({
    where: {
      storeId,
      status: { in: ACTIVE_ACTION_JOB_STATUSES },
      dismissedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return false;
  }

  try {
    await runEbayActionJob(job.id, worker);
    return true;
  } catch (error) {
    if (error instanceof JobConflictError) {
      return false;
    }

    throw error;
  }
}

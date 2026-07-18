import "server-only";

import { ProductStatus } from "@/app/generated/prisma/enums";
import { buildAddItemXML } from "@/lib/ebay-xml";
import { callEbayAddItem, getStoreNumber } from "@/lib/ebay";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { logger } from "@/lib/logger";
import { policyIdsMatch, resolveProductPolicySelection } from "@/lib/policy-defaults";
import { invalidateProductCaches } from "@/lib/cache-tags";
import {
  buildMissingItemSpecificsResponse,
  validateRequiredItemSpecifics,
} from "@/lib/ebay-required-specifics";
import { getEbayCustomLabel } from "@/lib/sku";
import { extractDuplicateListingItemId } from "@/lib/ebay-upload-reconciliation";
import { preserveEbayListingAsin } from "@/lib/ebay-listing-asin";
import {
  resolveMissingItemSpecificsForUploadRetry,
  shouldBlockUploadForRequiredSpecificsPreflight,
} from "@/lib/upload-item-specifics";
import { prisma } from "@/lib/prisma";

type UploadLogger = Pick<typeof logger, "info" | "warn" | "error">;

type UploadResponseBody = {
  success: boolean;
  itemId?: string;
  reconciled?: boolean;
  error?: string;
  missingItemSpecifics?: string[];
  requiredItemSpecifics?: Array<{
    name: string;
    values?: string[];
    inputType?: string | null;
  }>;
};

export type ProductUploadResult = {
  ok: boolean;
  status: number;
  body: UploadResponseBody;
  productTitle: string;
};

function isTooManyItemSpecificsError(message: string | undefined) {
  return /too many item specifics|maximum.+item specifics/i.test(message ?? "");
}

async function createSuccessUploadLog(input: {
  productId: string;
  storeId: string;
  userId: string;
  ebayItemId: string;
}) {
  try {
    await prisma.uploadLog.create({
      data: {
        productId: input.productId,
        storeId: input.storeId,
        userId: input.userId,
        status: "SUCCESS",
        ebayItemId: input.ebayItemId,
      },
    });
  } catch {
    // Upload logs are diagnostic only; never let logging put a live listing back into Drafts.
  }
}

async function createFailedUploadLog(input: {
  productId: string;
  storeId: string;
  userId: string;
  errorMessage: string;
}) {
  try {
    await prisma.uploadLog.create({
      data: {
        productId: input.productId,
        storeId: input.storeId,
        userId: input.userId,
        status: "FAILED",
        errorMessage: input.errorMessage,
      },
    });
  } catch {
    // Keep the product-facing failure even if diagnostic logging fails.
  }
}

async function markProductImported(input: {
  productId: string;
  storeId: string;
  userId: string;
  ebayItemId: string;
  asin?: string | null;
  price?: number;
}) {
  const ebayItemId = input.ebayItemId.trim();
  if (!ebayItemId) {
    throw new Error("eBay upload succeeded but did not return an item ID.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: input.productId },
      data: {
        status: ProductStatus.IMPORTED,
        ebayItemId,
        errorMessage: null,
        ...(input.price !== undefined ? { price: input.price } : {}),
      },
    });

    await preserveEbayListingAsin(tx, {
      storeId: input.storeId,
      ebayItemId,
      asin: input.asin,
    });
  });

  await createSuccessUploadLog({
    productId: input.productId,
    storeId: input.storeId,
    userId: input.userId,
    ebayItemId,
  });

  invalidateProductCaches(input.storeId);

  return ebayItemId;
}

async function getCurrentListedItemId(productId: string, storeId: string) {
  const currentProduct = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: { ebayItemId: true },
  });

  return currentProduct?.ebayItemId?.trim() || null;
}

export async function uploadProductToEbay(input: {
  productId: string;
  storeId: string;
  userId: string;
  log?: UploadLogger;
}): Promise<ProductUploadResult> {
  const log = input.log ?? logger;
  const { productId, storeId, userId } = input;
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId },
    include: { store: true },
  });

  if (!product) {
    log.warn("upload/product", "Product not found for upload", { productId });
    return {
      ok: false,
      status: 404,
      productTitle: "(missing)",
      body: { success: false, error: "Product not found" },
    };
  }

  try {
    const existingEbayItemId = product.ebayItemId?.trim();
    if (existingEbayItemId) {
      const itemId = await markProductImported({
        productId,
        storeId: product.storeId,
        userId,
        ebayItemId: existingEbayItemId,
        asin: product.asin,
      });

      log.info("upload/product", "Already-listed draft reconciled as imported", {
        productId,
        ebayItemId: itemId,
        previousStatus: product.status,
      });

      return {
        ok: true,
        status: 200,
        productTitle: product.title,
        body: { success: true, itemId, reconciled: true },
      };
    }

    if (
      product.status === ProductStatus.IMPORTED ||
      product.status === ProductStatus.ON_HOLD
    ) {
      log.warn("upload/product", "Rejected upload for listed product without eBay item id", {
        productId,
        status: product.status,
      });
      return {
        ok: false,
        status: 400,
        productTitle: product.title,
        body: {
          success: false,
          error: "Product is already listed on eBay but is missing the eBay item ID.",
        },
      };
    }

    const storeNumber = await getStoreNumber(product.storeId);
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

    const finalDescription = await resolveDescriptionTemplate(productWithPolicies);
    const supplierSettings = await prisma.supplierSettings.findUnique({
      where: {
        storeId_supplierName: {
          storeId: product.storeId,
          supplierName: "Amazon AU",
        },
      },
      select: {
        privateListing: true,
        automaticSkuFilling: true,
        defaultItemSpecifics: true,
      },
    });
    const requiredSpecifics = await validateRequiredItemSpecifics({
      product: productWithPolicies,
      storeNumber,
      supplierDefaultItemSpecifics: supplierSettings?.defaultItemSpecifics,
    });
    if (requiredSpecifics.decisions.length > 0) {
      log.info("upload/product", "Required item specifics preflight completed", {
        productId,
        decisions: requiredSpecifics.decisions,
        missingItemSpecifics: requiredSpecifics.missingItemSpecifics,
      });
    }

    const addedRequiredSpecifics = Object.keys(requiredSpecifics.addedItemSpecifics);
    if (
      addedRequiredSpecifics.length > 0 ||
      (requiredSpecifics.missingItemSpecifics.length === 0 &&
        product.status === ProductStatus.FAILED)
    ) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          itemSpecifics: requiredSpecifics.itemSpecifics,
          ...(requiredSpecifics.missingItemSpecifics.length === 0
            ? { status: ProductStatus.DRAFT, errorMessage: null }
            : {}),
        },
      });
    }

    if (shouldBlockUploadForRequiredSpecificsPreflight(requiredSpecifics)) {
      const errorMessage = `Add ${requiredSpecifics.missingItemSpecifics.join(", ")} before importing.`;

      await prisma.product.update({
        where: { id: productId },
        data: { status: "FAILED", errorMessage },
      });

      await createFailedUploadLog({
        productId,
        storeId: product.storeId,
        userId,
        errorMessage,
      });

      invalidateProductCaches(storeId);

      return {
        ok: false,
        status: 422,
        productTitle: product.title,
        body: {
          success: false,
          error: errorMessage,
          missingItemSpecifics: requiredSpecifics.missingItemSpecifics,
          requiredItemSpecifics: requiredSpecifics.requiredItemSpecifics,
        },
      };
    }

    if (requiredSpecifics.missingItemSpecifics.length > 0) {
      log.warn("upload/product", "Continuing upload with unresolved Taxonomy preflight specifics", {
        productId,
        missingItemSpecifics: requiredSpecifics.missingItemSpecifics,
      });
    }

    const productWithResolvedDesc = {
      ...productWithPolicies,
      itemSpecifics: requiredSpecifics.itemSpecifics,
      description: finalDescription,
    };
    const requiredItemSpecificNames = requiredSpecifics.requiredItemSpecifics.map(
      (specific) => specific.name,
    );
    const variants = await prisma.variant.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "asc" },
    });
    const primarySellPrice =
      variants.length > 0 ? Number(variants[0].sellPrice) : null;
    const customLabel = getEbayCustomLabel({
      variantSku: variants[0]?.sku,
      asin: product.asin,
      automaticSkuFilling: supplierSettings?.automaticSkuFilling ?? true,
    });
    const overrideStartPrice =
      primarySellPrice !== null &&
      Number.isFinite(primarySellPrice) &&
      primarySellPrice > 0
        ? primarySellPrice
        : undefined;
    const addItemOptions = {
      privateListing: supplierSettings?.privateListing ?? false,
      customLabel,
      requiredItemSpecificNames,
    };

    async function sendAddItem(
      productForXml: typeof productWithResolvedDesc,
      options: typeof addItemOptions & { itemSpecificMaxCount?: number },
    ) {
      let xml = buildAddItemXML(productForXml, overrideStartPrice, options);
      let result = await callEbayAddItem(xml, storeNumber);

      if (!result.success && isTooManyItemSpecificsError(result.errorMessage)) {
        log.warn("upload/product", "Retrying AddItem with reduced item specifics", {
          productId,
          storeNumber,
          ebayError: result.errorMessage,
        });

        xml = buildAddItemXML(productForXml, overrideStartPrice, {
          ...options,
          itemSpecificMaxCount: 12,
        });
        result = await callEbayAddItem(xml, storeNumber);
      }

      return result;
    }

    log.info("upload/product", "Sending AddItem request to eBay", {
      productId,
      storeNumber,
      productTitle: product.title,
      startPrice: overrideStartPrice ?? Number(product.price),
      privateListing: supplierSettings?.privateListing ?? false,
      customLabel,
    });

    let result = await sendAddItem(productWithResolvedDesc, addItemOptions);

    if (!result.success) {
      const initialMissingSpecificsResponse = buildMissingItemSpecificsResponse(
        result.errorMessage,
        requiredSpecifics.requiredItemSpecifics,
      );

      if (initialMissingSpecificsResponse.missingItemSpecifics.length > 0) {
        const retrySpecifics = resolveMissingItemSpecificsForUploadRetry({
          title: product.fullTitle || product.title,
          categoryName: product.categoryName,
          description: finalDescription,
          brand: requiredSpecifics.itemSpecifics.Brand,
          itemSpecifics: productWithResolvedDesc.itemSpecifics,
          supplierDefaultItemSpecifics: supplierSettings?.defaultItemSpecifics,
          missingItemSpecifics: initialMissingSpecificsResponse.missingItemSpecifics,
          requiredItemSpecifics: requiredSpecifics.requiredItemSpecifics,
        });

        if (retrySpecifics.shouldRetry) {
          log.info("upload/product", "Retrying AddItem after resolving eBay missing specifics", {
            productId,
            storeNumber,
            decisions: retrySpecifics.decisions,
            missingItemSpecifics: retrySpecifics.missingItemSpecifics,
          });

          await prisma.product.update({
            where: { id: product.id },
            data: { itemSpecifics: retrySpecifics.itemSpecifics },
          });

          productWithResolvedDesc.itemSpecifics = retrySpecifics.itemSpecifics;
          result = await sendAddItem(productWithResolvedDesc, {
            ...addItemOptions,
            requiredItemSpecificNames: Array.from(
              new Set([
                ...addItemOptions.requiredItemSpecificNames,
                ...retrySpecifics.requiredItemSpecifics.map((specific) => specific.name),
              ]),
            ),
          });
        }
      }
    }

    if (result.success) {
      log.info("upload/product", "eBay AddItem succeeded", {
        productId,
        ebayItemId: result.itemId,
        storeNumber,
      });

      const itemId = await markProductImported({
        productId,
        storeId: product.storeId,
        userId,
        ebayItemId: result.itemId ?? "",
        asin: product.asin,
        price: overrideStartPrice,
      });

      return {
        ok: true,
        status: 200,
        productTitle: product.title,
        body: { success: true, itemId },
      };
    }

    const currentListedItemId = await getCurrentListedItemId(
      productId,
      product.storeId,
    );
    if (currentListedItemId) {
      const itemId = await markProductImported({
        productId,
        storeId: product.storeId,
        userId,
        ebayItemId: currentListedItemId,
        asin: product.asin,
        price: overrideStartPrice,
      });

      log.warn("upload/product", "Ignored stale AddItem failure because product is already listed", {
        productId,
        ebayItemId: itemId,
        storeNumber,
        staleError: result.errorMessage,
      });

      return {
        ok: true,
        status: 200,
        productTitle: product.title,
        body: { success: true, itemId, reconciled: true },
      };
    }

    const duplicateListingItemId = extractDuplicateListingItemId(result.errorMessage);
    if (duplicateListingItemId) {
      const existingProduct = await prisma.product.findFirst({
        where: {
          id: { not: productId },
          storeId: product.storeId,
          ebayItemId: duplicateListingItemId,
        },
        select: { id: true },
      });

      if (!existingProduct) {
        const itemId = await markProductImported({
          productId,
          storeId: product.storeId,
          userId,
          ebayItemId: duplicateListingItemId,
          asin: product.asin,
          price: overrideStartPrice,
        });

        log.warn("upload/product", "Duplicate listing response reconciled as imported", {
          productId,
          ebayItemId: itemId,
          storeNumber,
          ebayError: result.errorMessage,
        });

        return {
          ok: true,
          status: 200,
          productTitle: product.title,
          body: { success: true, itemId, reconciled: true },
        };
      }
    }

    const missingSpecificsResponse = buildMissingItemSpecificsResponse(
      result.errorMessage,
      requiredSpecifics.requiredItemSpecifics,
    );
    const cleanErrorMessage =
      missingSpecificsResponse.missingItemSpecifics.length > 0
        ? `Add ${missingSpecificsResponse.missingItemSpecifics.join(", ")} before importing.`
        : result.errorMessage || "eBay AddItem failed.";

    log.error("upload/product", "eBay AddItem failed", undefined, {
      productId,
      storeNumber,
      ebayError: cleanErrorMessage,
    });

    await prisma.product.update({
      where: { id: productId },
      data: { status: "FAILED", errorMessage: cleanErrorMessage },
    });

    await createFailedUploadLog({
      productId,
      storeId: product.storeId,
      userId,
      errorMessage: cleanErrorMessage,
    });

    invalidateProductCaches(storeId);

    return {
      ok: false,
      status: 422,
      productTitle: product.title,
      body: {
        success: false,
        error: cleanErrorMessage,
        ...missingSpecificsResponse,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    log.error("upload/product", "Unhandled error while uploading product", error, {
      productId,
    });

    await createFailedUploadLog({
      productId,
      storeId: product.storeId,
      userId,
      errorMessage: message,
    });

    invalidateProductCaches(storeId);

    const isValidationError =
      message.includes("Policy") || message.includes("Category");

    return {
      ok: false,
      status: isValidationError ? 422 : 500,
      productTitle: product.title,
      body: { success: false, error: message },
    };
  }
}

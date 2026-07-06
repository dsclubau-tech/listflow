import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildAddItemXML } from "@/lib/ebay-xml";
import { callEbayAddItem, getStoreNumber } from "@/lib/ebay";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { createRequestLogger } from "@/lib/logger";
import { ProductStatus } from "@/app/generated/prisma/enums";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { policyIdsMatch, resolveProductPolicySelection } from "@/lib/policy-defaults";
import { invalidateProductCaches } from "@/lib/cache-tags";
import {
  buildMissingItemSpecificsResponse,
  validateRequiredItemSpecifics,
} from "@/lib/ebay-required-specifics";
import { getEbayCustomLabel } from "@/lib/sku";
import { extractDuplicateListingItemId } from "@/lib/ebay-upload-reconciliation";

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

async function markProductImported(input: {
  productId: string;
  storeId: string;
  userId: string;
  ebayItemId: string;
  price?: number;
}) {
  const ebayItemId = input.ebayItemId.trim();
  if (!ebayItemId) {
    throw new Error("eBay upload succeeded but did not return an item ID.");
  }

  await prisma.product.update({
    where: { id: input.productId },
    data: {
      status: ProductStatus.IMPORTED,
      ebayItemId,
      errorMessage: null,
      ...(input.price !== undefined ? { price: input.price } : {}),
    },
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

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("upload/route", "Unauthorized upload attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    log.error("upload/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { productId } = body;

  if (!productId) {
    log.warn("upload/route", "Upload request missing productId");
    return NextResponse.json(
      { error: "productId is required" },
      { status: 400 },
    );
  }

  log.info("upload/route", "Upload request received", { productId });

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: storeSession.storeId },
    include: { store: true },
  });

  if (!product) {
    log.warn("upload/route", "Product not found for upload", { productId });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  try {
    const userId = await getInternalUserId();

    const existingEbayItemId = product.ebayItemId?.trim();
    if (existingEbayItemId) {
      const itemId = await markProductImported({
        productId,
        storeId: product.storeId,
        userId,
        ebayItemId: existingEbayItemId,
      });

      log.info("upload/route", "Already-listed draft reconciled as imported", {
        productId,
        ebayItemId: itemId,
        previousStatus: product.status,
      });

      return NextResponse.json({ success: true, itemId, reconciled: true });
    }

    if (
      product.status === ProductStatus.IMPORTED ||
      product.status === ProductStatus.ON_HOLD
    ) {
      log.warn("upload/route", "Rejected upload for listed product without eBay item id", {
        productId,
        status: product.status,
      });
      return NextResponse.json(
        { error: "Product is already listed on eBay but is missing the eBay item ID." },
        { status: 400 },
      );
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
      log.info("upload/route", "Required item specifics preflight completed", {
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

    if (requiredSpecifics.missingItemSpecifics.length > 0) {
      const errorMessage = `Add ${requiredSpecifics.missingItemSpecifics.join(", ")} before importing.`;

      await prisma.product.update({
        where: { id: productId },
        data: { status: "FAILED", errorMessage },
      });

      await prisma.uploadLog.create({
        data: {
          productId,
          storeId: product.storeId,
          userId,
          status: "FAILED",
          errorMessage,
        },
      });

      invalidateProductCaches(storeSession.storeId);

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          missingItemSpecifics: requiredSpecifics.missingItemSpecifics,
          requiredItemSpecifics: requiredSpecifics.requiredItemSpecifics,
        },
        { status: 422 },
      );
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
    const primarySellPrice = variants.length > 0
      ? Number(variants[0].sellPrice)
      : null;
    const customLabel = getEbayCustomLabel({
      variantSku: variants[0]?.sku,
      asin: product.asin,
      automaticSkuFilling: supplierSettings?.automaticSkuFilling ?? true,
    });
    const overrideStartPrice =
      primarySellPrice !== null && Number.isFinite(primarySellPrice) && primarySellPrice > 0
        ? primarySellPrice
        : undefined;
    const addItemOptions = {
      privateListing: supplierSettings?.privateListing ?? false,
      customLabel,
      requiredItemSpecificNames,
    };
    let xml = buildAddItemXML(productWithResolvedDesc, overrideStartPrice, addItemOptions);

    log.info("upload/route", "Sending AddItem request to eBay", {
      productId,
      storeNumber,
      productTitle: product.title,
      startPrice: overrideStartPrice ?? Number(product.price),
      privateListing: supplierSettings?.privateListing ?? false,
      customLabel,
    });

    let result = await callEbayAddItem(xml, storeNumber);

    if (!result.success && isTooManyItemSpecificsError(result.errorMessage)) {
      log.warn("upload/route", "Retrying AddItem with reduced item specifics", {
        productId,
        storeNumber,
        ebayError: result.errorMessage,
      });

      xml = buildAddItemXML(productWithResolvedDesc, overrideStartPrice, {
        ...addItemOptions,
        itemSpecificMaxCount: 12,
      });
      result = await callEbayAddItem(xml, storeNumber);
    }

    if (result.success) {
      log.info("upload/route", "eBay AddItem succeeded", {
        productId,
        ebayItemId: result.itemId,
        storeNumber,
      });

      const itemId = await markProductImported({
        productId,
        storeId: product.storeId,
        userId,
        ebayItemId: result.itemId ?? "",
        price: overrideStartPrice,
      });

      return NextResponse.json({ success: true, itemId });
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
        price: overrideStartPrice,
      });

      log.warn("upload/route", "Ignored stale AddItem failure because product is already listed", {
        productId,
        ebayItemId: itemId,
        storeNumber,
        staleError: result.errorMessage,
      });

      return NextResponse.json({ success: true, itemId, reconciled: true });
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
          price: overrideStartPrice,
        });

        log.warn("upload/route", "Duplicate listing response reconciled as imported", {
          productId,
          ebayItemId: itemId,
          storeNumber,
          ebayError: result.errorMessage,
        });

        return NextResponse.json({ success: true, itemId, reconciled: true });
      }
    }

    const missingSpecificsResponse = buildMissingItemSpecificsResponse(
      result.errorMessage
    );
    const cleanErrorMessage =
      missingSpecificsResponse.missingItemSpecifics.length > 0
        ? `Add ${missingSpecificsResponse.missingItemSpecifics.join(", ")} before importing.`
        : result.errorMessage;

    log.error("upload/route", "eBay AddItem failed", undefined, {
      productId,
      storeNumber,
      ebayError: cleanErrorMessage,
    });

    await prisma.product.update({
      where: { id: productId },
      data: { status: "FAILED", errorMessage: cleanErrorMessage },
    });

    await prisma.uploadLog.create({
      data: {
        productId,
        storeId: product.storeId,
        userId,
        status: "FAILED",
        errorMessage: cleanErrorMessage,
      },
    });

    invalidateProductCaches(storeSession.storeId);

    return NextResponse.json(
      {
        success: false,
        error: cleanErrorMessage,
        ...missingSpecificsResponse,
      },
      { status: 422 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    log.error("upload/route", "Unhandled error in upload route", error, {
      productId,
    });

    await prisma.uploadLog.create({
      data: {
        productId,
        storeId: product.storeId,
        userId: await getInternalUserId(),
        status: "FAILED",
        errorMessage: message,
      },
    });

    invalidateProductCaches(storeSession.storeId);

    const isValidationError =
      message.includes("Policy") || message.includes("Category");

    return NextResponse.json(
      { success: false, error: message },
      { status: isValidationError ? 422 : 500 },
    );
  }
}

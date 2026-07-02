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

function isTooManyItemSpecificsError(message: string | undefined) {
  return /too many item specifics|maximum.+item specifics/i.test(message ?? "");
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

  if (
    product.ebayItemId ||
    product.status === ProductStatus.IMPORTED ||
    product.status === ProductStatus.ON_HOLD
  ) {
    log.warn("upload/route", "Rejected upload for already listed product", {
      productId,
      status: product.status,
      ebayItemId: product.ebayItemId,
    });
    return NextResponse.json(
      { error: "Product is already listed on eBay" },
      { status: 400 },
    );
  }

  try {
    const userId = await getInternalUserId();
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
        defaultItemSpecifics: true,
      },
    });
    const requiredSpecifics = await validateRequiredItemSpecifics({
      product: productWithPolicies,
      storeNumber,
      supplierDefaultItemSpecifics: supplierSettings?.defaultItemSpecifics,
    });

    if (Object.keys(requiredSpecifics.addedItemSpecifics).length > 0) {
      await prisma.product.update({
        where: { id: product.id },
        data: { itemSpecifics: requiredSpecifics.itemSpecifics },
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
    const variants = await prisma.variant.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "asc" },
    });
    const primarySellPrice = variants.length > 0
      ? Number(variants[0].sellPrice)
      : null;
    const overrideStartPrice =
      primarySellPrice !== null && Number.isFinite(primarySellPrice) && primarySellPrice > 0
        ? primarySellPrice
        : undefined;
    const addItemOptions = {
      privateListing: supplierSettings?.privateListing ?? false,
    };
    let xml = buildAddItemXML(productWithResolvedDesc, overrideStartPrice, addItemOptions);

    log.info("upload/route", "Sending AddItem request to eBay", {
      productId,
      storeNumber,
      productTitle: product.title,
      startPrice: overrideStartPrice ?? Number(product.price),
      privateListing: supplierSettings?.privateListing ?? false,
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

      await prisma.product.update({
        where: { id: productId },
        data: {
          status: "IMPORTED",
          ebayItemId: result.itemId,
          errorMessage: null,
          ...(overrideStartPrice !== undefined ? { price: overrideStartPrice } : {}),
        },
      });

      await prisma.uploadLog.create({
        data: {
          productId,
          storeId: product.storeId,
          userId,
          status: "SUCCESS",
          ebayItemId: result.itemId,
        },
      });

      invalidateProductCaches(storeSession.storeId);

      return NextResponse.json({ success: true, itemId: result.itemId });
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

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createRequestLogger } from "@/lib/logger";
import { applyKeywordFilter } from "@/lib/keyword-filter";
import { getCurrentStoreSession } from "@/lib/store-session";
import { sanitizeEbayItemSpecifics } from "@/lib/item-specifics";
import { resolveProductPolicySelection } from "@/lib/policy-defaults";
import { invalidateProductCaches } from "@/lib/cache-tags";
import { isValidAsin, normalizeAsin } from "@/lib/price-check-eligibility";
import { ProductStatus } from "@/app/generated/prisma/enums";
import { applyEbayLocationMetadata } from "@/lib/ebay-location";
import { isAmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";
import {
  MAX_EBAY_PICTURES,
  dedupeProductImages,
} from "@/lib/product-images";
import { normalizeFullProductTitle, toEbayListingTitle } from "@/lib/product-title";
import { deleteProductFromListflow } from "@/lib/product-removal";
import { preserveEbayListingAsin } from "@/lib/ebay-listing-asin";

const SUPPLIER_NAME = "Amazon AU";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("api/products/PATCH", "Unauthorized attempt", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  log.info("api/products/PATCH", "Update request received", { id });

  const product = await prisma.product.findFirst({
    where: { id, storeId: storeSession.storeId },
  });

  if (!product) {
    log.warn("api/products/PATCH", "Product not found", { id });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
    log.info("api/products/PATCH", "Parsing request body", {
      id,
      fields: Object.keys(body),
    });
  } catch (error) {
    log.error("api/products/PATCH", "Invalid JSON body", error, { id });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowedFields = [
    "title",
    "fullTitle",
    "description",
    "price",
    "quantity",
    "category",
    "categoryName",
    "asin",
    "condition",
    "images",
    "itemSpecifics",
    "shippingPolicyId",
    "returnPolicyId",
    "paymentPolicyId",
    "policyTemplateId",
    "templateId",
    "internalNote",
    "promotedAdPercent",
    "amazonPriceTrackingMode",
  ];

  const data: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    log.warn("api/products/PATCH", "No valid fields to update", { id });
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  if (data.title !== undefined) {
    if (typeof data.title !== "string" || !data.title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    data.title = toEbayListingTitle(data.title as string);
  }

  if (data.fullTitle !== undefined) {
    if (data.fullTitle !== null && typeof data.fullTitle !== "string") {
      return NextResponse.json(
        { error: "Full title must be a string or null" },
        { status: 400 },
      );
    }
    data.fullTitle =
      typeof data.fullTitle === "string"
        ? normalizeFullProductTitle(data.fullTitle as string) || null
        : null;
  }

  if (data.description !== undefined) {
    if (typeof data.description !== "string" || !data.description.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }
  }

  if (data.price !== undefined) {
    const numericPrice = Number(data.price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return NextResponse.json({ error: "Price must be greater than 0" }, { status: 400 });
    }

    const isAmazonBackedProduct = Boolean(product.asin);
    const isAmazonPriceUpdate = body.amazonPriceUpdateSource === "regrab";
    const existingPrice = Number(product.price);

    if (
      isAmazonBackedProduct &&
      !isAmazonPriceUpdate &&
      Math.abs(numericPrice - existingPrice) > 0.009
    ) {
      return NextResponse.json(
        {
          error:
            "Amazon buy price is supplier-controlled. Use Regrab or a price check to update it.",
        },
        { status: 400 },
      );
    }

    if (isAmazonBackedProduct && !isAmazonPriceUpdate) {
      delete data.price;
    } else {
      data.price = numericPrice;
      if (isAmazonBackedProduct) {
        data.amazonPrice = numericPrice;
      }
    }
  }

  if (data.quantity !== undefined) {
    const numericQuantity = Number(data.quantity);
    if (!Number.isInteger(numericQuantity) || numericQuantity < 0) {
      return NextResponse.json({ error: "Quantity must be 0 or greater" }, { status: 400 });
    }
    data.quantity = numericQuantity;
    if (
      numericQuantity === 0 &&
      (product.status === ProductStatus.IMPORTED ||
        product.status === ProductStatus.ON_HOLD)
    ) {
      data.status = ProductStatus.ON_HOLD;
    }
  }

  if (data.promotedAdPercent !== undefined) {
    const numericPromotedAdPercent = Number(data.promotedAdPercent);
    if (
      !Number.isFinite(numericPromotedAdPercent) ||
      numericPromotedAdPercent < 0 ||
      numericPromotedAdPercent > 100
    ) {
      return NextResponse.json(
        { error: "Local promoted ad reference must be between 0 and 100" },
        { status: 400 },
      );
    }

    if (product.status === "DRAFT" || product.status === "FAILED") {
      data.promotedAdPercent = numericPromotedAdPercent;
    } else {
      delete data.promotedAdPercent;
    }
  }

  if (data.amazonPriceTrackingMode !== undefined) {
    if (!isAmazonPriceTrackingMode(data.amazonPriceTrackingMode)) {
      return NextResponse.json(
        { error: "Amazon price tracking mode must be REGULAR or DEAL" },
        { status: 400 },
      );
    }
  }

  if (data.category !== undefined) {
    if (typeof data.category !== "string" || !/^\d+$/.test(data.category.trim())) {
      return NextResponse.json(
        { error: "Category must be a numeric eBay Category ID" },
        { status: 400 },
      );
    }
    data.category = data.category.trim();
  }

  if (data.asin !== undefined) {
    if (data.asin !== null && typeof data.asin !== "string") {
      return NextResponse.json(
        { error: "ASIN must be a string or null" },
        { status: 400 },
      );
    }

    const normalizedAsin = normalizeAsin(data.asin);

    if (normalizedAsin && !isValidAsin(normalizedAsin)) {
      return NextResponse.json(
        { error: "ASIN must be 10 letters or numbers" },
        { status: 400 },
      );
    }

    data.asin = normalizedAsin;

    if (normalizedAsin && normalizedAsin !== product.asin) {
      data.priceCheckError = null;
      data.lastPriceCheck = null;
    }
  }

  if (data.images !== undefined) {
    const allNormalizedImages = Array.isArray(data.images)
      ? dedupeProductImages(data.images, Number.MAX_SAFE_INTEGER)
      : [];

    if (allNormalizedImages.length > MAX_EBAY_PICTURES) {
      return NextResponse.json(
        { error: `eBay supports up to ${MAX_EBAY_PICTURES} listing images` },
        { status: 400 },
      );
    }

    const normalizedImages = Array.isArray(data.images)
      ? dedupeProductImages(data.images)
      : [];

    if (normalizedImages.length === 0) {
      return NextResponse.json(
        { error: "At least one valid image URL is required" },
        { status: 400 },
      );
    }

    data.images = normalizedImages;
  }

  if (data.itemSpecifics !== undefined) {
    const supplierSettings =
      (await prisma.supplierSettings.findUnique({
        where: {
          storeId_supplierName: {
            storeId: storeSession.storeId,
            supplierName: SUPPLIER_NAME,
          },
        },
        select: { defaultCountry: true, defaultZipcode: true },
      })) ??
      (await prisma.supplierSettings.findFirst({
        where: { storeId: null, supplierName: SUPPLIER_NAME },
        select: { defaultCountry: true, defaultZipcode: true },
      }));

    data.itemSpecifics = applyEbayLocationMetadata(
      sanitizeEbayItemSpecifics(data.itemSpecifics),
      {
        country: supplierSettings?.defaultCountry ?? "Australia",
        postalCode: supplierSettings?.defaultZipcode ?? "3170",
      },
    );

    if (product.status === ProductStatus.FAILED) {
      data.status = ProductStatus.DRAFT;
      data.errorMessage = null;
    }
  }

  const includesPolicyUpdate =
    data.shippingPolicyId !== undefined ||
    data.returnPolicyId !== undefined ||
    data.paymentPolicyId !== undefined ||
    data.policyTemplateId !== undefined;

  if (includesPolicyUpdate) {
    try {
      const policySelection = await resolveProductPolicySelection(
        storeSession.storeId,
        {
          shippingPolicyId:
            data.shippingPolicyId !== undefined
              ? data.shippingPolicyId
              : product.shippingPolicyId,
          returnPolicyId:
            data.returnPolicyId !== undefined
              ? data.returnPolicyId
              : product.returnPolicyId,
          paymentPolicyId:
            data.paymentPolicyId !== undefined
              ? data.paymentPolicyId
              : product.paymentPolicyId,
        },
        data.policyTemplateId !== undefined
          ? data.policyTemplateId
          : product.policyTemplateId,
      );

      data.shippingPolicyId = policySelection.shippingPolicyId;
      data.returnPolicyId = policySelection.returnPolicyId;
      data.paymentPolicyId = policySelection.paymentPolicyId;
      data.policyTemplateId = policySelection.policyTemplateId;
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Policy template not found",
        },
        { status: 400 },
      );
    }
  }

  if (data.internalNote !== undefined) {
    if (data.internalNote !== null && typeof data.internalNote !== "string") {
      return NextResponse.json(
        { error: "internalNote must be a string or null" },
        { status: 400 },
      );
    }

    data.internalNote =
      typeof data.internalNote === "string"
        ? data.internalNote.trim() || null
        : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ success: true });
  }

  try {
    const titleStr = typeof data.title === "string" ? data.title : undefined;
    const fullTitleStr = typeof data.fullTitle === "string" ? data.fullTitle : undefined;
    const descStr = typeof data.description === "string" ? data.description : undefined;
    let removedKeywords: string[] = [];

    if (fullTitleStr || titleStr || descStr) {
      let filteredDescription = descStr || product.description;
      const removedKeywordSet = new Set<string>();

      if (fullTitleStr) {
        const filteredFullTitle = await applyKeywordFilter(
          fullTitleStr,
          filteredDescription,
          storeSession.storeId,
        );
        data.fullTitle = normalizeFullProductTitle(filteredFullTitle.title);
        filteredDescription = filteredFullTitle.description;
        filteredFullTitle.removedKeywords.forEach((keyword) =>
          removedKeywordSet.add(keyword)
        );

        if (!titleStr) {
          data.title = toEbayListingTitle(filteredFullTitle.title);
        }
      }

      if (titleStr) {
        const filteredListingTitle = await applyKeywordFilter(
          titleStr,
          filteredDescription,
          storeSession.storeId,
        );
        data.title = toEbayListingTitle(filteredListingTitle.title);
        filteredDescription = filteredListingTitle.description;
        filteredListingTitle.removedKeywords.forEach((keyword) =>
          removedKeywordSet.add(keyword)
        );
      }

      if (descStr) data.description = filteredDescription;
      removedKeywords = [...removedKeywordSet];
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id },
        data,
        include: { store: true, createdBy: true },
      });

      if (data.asin !== undefined && updatedProduct.ebayItemId) {
        if (updatedProduct.asin) {
          await preserveEbayListingAsin(tx, {
            storeId: storeSession.storeId,
            ebayItemId: updatedProduct.ebayItemId,
            asin: updatedProduct.asin,
          });
        } else {
          await tx.ebayListingAsin.deleteMany({
            where: {
              storeId: storeSession.storeId,
              ebayItemId: updatedProduct.ebayItemId,
            },
          });
        }
      }

      return updatedProduct;
    });

    invalidateProductCaches(storeSession.storeId);

    log.info("api/products/PATCH", "Update successful", { id });
    return NextResponse.json({ ...updated, removedKeywords });
  } catch (error) {
    log.error("api/products/PATCH", "Database update failed", error, { id });
    return NextResponse.json({ error: "Database update failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("api/products/DELETE", "Unauthorized delete attempt", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const product = await prisma.product.findFirst({
    where: { id, storeId: storeSession.storeId },
  });

  if (!product) {
    log.warn("api/products/DELETE", "Product not found", { id });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  try {
    const result = await deleteProductFromListflow(storeSession.storeId, id);

    invalidateProductCaches(storeSession.storeId);

    log.info("api/products/DELETE", "Product removed from ListFlow", {
      id,
      ebayItemId: product.ebayItemId,
      deletedProducts: result.deletedProducts,
      deletedVariants: result.deletedVariants,
      deletedPriceHistory: result.deletedPriceHistory,
      deletedUploadLogs: result.deletedUploadLogs,
    });
    return NextResponse.json({ success: true, deleted: result.deletedProducts });
  } catch (error) {
    log.error("api/products/DELETE", "Delete failed", error, { id });
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}

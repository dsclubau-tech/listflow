import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { applyKeywordFilter } from "@/lib/keyword-filter";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { sanitizeEbayItemSpecifics } from "@/lib/item-specifics";
import { resolveProductPolicySelection } from "@/lib/policy-defaults";
import { invalidateDraftCaches } from "@/lib/cache-tags";
import { getEbayCategoryAspects, getStoreNumber } from "@/lib/ebay";
import { resolveRequiredItemSpecifics } from "@/lib/required-specific-resolver";
import { applyEbayLocationMetadata } from "@/lib/ebay-location";
import { normalizeAmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";
import { dedupeProductImages } from "@/lib/product-images";
import { normalizeFullProductTitle, toEbayListingTitle } from "@/lib/product-title";
import { Prisma } from "@/app/generated/prisma/client";
import { isValidAsin, normalizeAsin } from "@/lib/price-check-eligibility";
import {
  DuplicateAmazonProductError,
  findExistingAmazonProduct,
  getDuplicateAmazonProductBody,
} from "@/lib/product-duplicate";
import { buildDefaultVariantData } from "@/lib/variants";

const SUPPLIER_NAME = "Amazon AU";

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    title,
    fullTitle,
    description,
    price,
    quantity,
    category,
    categoryName,
    condition,
    images,
    itemSpecifics,
    storeId,
    asin,
    shippingPolicyId,
    returnPolicyId,
    paymentPolicyId,
    policyTemplateId,
    templateId,
    allowIncompleteDraft,
    promotedAdPercent,
    amazonPriceTrackingMode,
  } = body;
  const isIncompleteDraftAllowed = allowIncompleteDraft === true;
  const normalizedPrice =
    price === undefined || price === null || price === "" ? 0 : Number(price);
  const normalizedQuantity =
    quantity === undefined || quantity === null || quantity === ""
      ? 1
      : Number(quantity);
  const normalizedCategory = typeof category === "string" ? category.trim() : "";
  const normalizedPromotedAdPercent =
    promotedAdPercent === undefined ||
    promotedAdPercent === null ||
    promotedAdPercent === ""
      ? 0
      : Number(promotedAdPercent);
  const normalizedAmazonPriceTrackingMode = normalizeAmazonPriceTrackingMode(
    amazonPriceTrackingMode
  );
  const normalizedImages = Array.isArray(images)
    ? dedupeProductImages(images)
    : [];
  const normalizedAsin = normalizeAsin(asin);

  // Validate required fields
  if (!title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!description?.trim()) {
    return NextResponse.json(
      { error: "Description is required" },
      { status: 400 }
    );
  }
  if (
    !Number.isFinite(normalizedPrice) ||
    normalizedPrice < 0 ||
    (!isIncompleteDraftAllowed && (price === undefined || price === null))
  ) {
    return NextResponse.json(
      { error: "Valid price is required" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
    return NextResponse.json(
      { error: "Quantity must be at least 1" },
      { status: 400 }
    );
  }
  if (
    !Number.isFinite(normalizedPromotedAdPercent) ||
    normalizedPromotedAdPercent < 0 ||
    normalizedPromotedAdPercent > 100
  ) {
    return NextResponse.json(
      { error: "Local promoted ad reference must be between 0 and 100" },
      { status: 400 }
    );
  }
  if (!isIncompleteDraftAllowed && !normalizedCategory) {
    return NextResponse.json(
      { error: "Category is required" },
      { status: 400 }
    );
  }
  if (storeId && storeId !== storeSession.storeId) {
    return NextResponse.json(
      { error: "Store not found" },
      { status: 400 }
    );
  }
  if (normalizedImages.length === 0) {
    return NextResponse.json(
      { error: "At least one image is required" },
      { status: 400 }
    );
  }
  if (normalizedAsin && !isValidAsin(normalizedAsin)) {
    return NextResponse.json({ error: "ASIN must be 10 letters or numbers" }, { status: 400 });
  }

  // Validate store exists
  const store = await prisma.store.findUnique({
    where: { id: storeSession.storeId },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
  }

  if (normalizedAsin) {
    const existingProduct = await findExistingAmazonProduct(
      storeSession.storeId,
      normalizedAsin,
      prisma,
    );

    if (existingProduct) {
      return NextResponse.json(
        getDuplicateAmazonProductBody(existingProduct),
        { status: 409 },
      );
    }
  }

  let policySelection;
  try {
    policySelection = await resolveProductPolicySelection(
      storeSession.storeId,
      {
        shippingPolicyId,
        returnPolicyId,
        paymentPolicyId,
      },
      policyTemplateId,
    );
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

  try {
    // Apply keyword blacklist filter
    const sourceFullTitle = normalizeFullProductTitle(
      typeof fullTitle === "string" && fullTitle.trim() ? fullTitle : title,
    );
    const filtered = await applyKeywordFilter(
      sourceFullTitle,
      description.trim(),
      storeSession.storeId
    );
    const filteredFullTitle = normalizeFullProductTitle(filtered.title);
    const listingTitle = toEbayListingTitle(filteredFullTitle);
    const createdById = await getInternalUserId();
    let resolvedItemSpecifics = sanitizeEbayItemSpecifics(itemSpecifics);
    const supplierSettings =
      (await prisma.supplierSettings.findUnique({
        where: {
          storeId_supplierName: {
            storeId: storeSession.storeId,
            supplierName: SUPPLIER_NAME,
          },
        },
        select: {
          defaultCountry: true,
          defaultZipcode: true,
          automaticSkuFilling: true,
          ebayFeePercent: true,
          fixedFeeAmount: true,
          additionalProfitPercent: true,
          additionalProfitFixed: true,
          minimumProfit: true,
        },
      })) ??
      (await prisma.supplierSettings.findFirst({
        where: { storeId: null, supplierName: SUPPLIER_NAME },
        select: {
          defaultCountry: true,
          defaultZipcode: true,
          automaticSkuFilling: true,
          ebayFeePercent: true,
          fixedFeeAmount: true,
          additionalProfitPercent: true,
          additionalProfitFixed: true,
          minimumProfit: true,
        },
      }));

    if (/^\d+$/.test(normalizedCategory)) {
      try {
        const storeNumber = await getStoreNumber(storeSession.storeId);
        const aspects = await getEbayCategoryAspects(
          normalizedCategory,
          storeNumber,
        );
        const requiredItemSpecifics = aspects
          .filter((aspect) => aspect.required)
          .map((aspect) => ({
            name: aspect.name,
            values: aspect.values.length > 0 ? aspect.values : undefined,
            inputType: aspect.inputType,
          }));

        if (requiredItemSpecifics.length > 0) {
          const resolved = resolveRequiredItemSpecifics({
            title: filteredFullTitle,
            categoryName: categoryName || null,
            description: filtered.description,
            brand: resolvedItemSpecifics.Brand,
            itemSpecifics: resolvedItemSpecifics,
            requiredItemSpecifics,
          });
          resolvedItemSpecifics = sanitizeEbayItemSpecifics(
            resolved.itemSpecifics,
          );
        }
      } catch {
        // Draft creation should not fail only because eBay Taxonomy is unavailable.
      }
    }

    resolvedItemSpecifics = applyEbayLocationMetadata(resolvedItemSpecifics, {
      country: supplierSettings?.defaultCountry ?? "Australia",
      postalCode: supplierSettings?.defaultZipcode ?? "3170",
    });

    const createProduct = async () => {
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              if (normalizedAsin) {
                const existingProduct = await findExistingAmazonProduct(
                  storeSession.storeId,
                  normalizedAsin,
                  tx,
                );

                if (existingProduct) {
                  throw new DuplicateAmazonProductError(existingProduct);
                }
              }

              const createdProduct = await tx.product.create({
                data: {
                  title: listingTitle,
                  fullTitle: filteredFullTitle || null,
                  description: filtered.description,
                  price: normalizedPrice,
                  quantity: normalizedQuantity,
                  category: normalizedCategory,
                  categoryName: categoryName || null,
                  condition: condition || "New",
                  images: normalizedImages,
                  itemSpecifics: resolvedItemSpecifics,
                  status: "DRAFT",
                  storeId: storeSession.storeId,
                  createdById,
                  asin: normalizedAsin,
                  amazonPrice: normalizedAsin ? normalizedPrice : null,
                  amazonPriceTrackingMode: normalizedAmazonPriceTrackingMode,
                  promotedAdPercent: normalizedPromotedAdPercent,
                  shippingPolicyId: policySelection.shippingPolicyId,
                  returnPolicyId: policySelection.returnPolicyId,
                  paymentPolicyId: policySelection.paymentPolicyId,
                  policyTemplateId: policySelection.policyTemplateId,
                  templateId:
                    (typeof templateId === "string" && templateId.trim()
                      ? templateId.trim()
                      : null) ?? policySelection.descriptionTemplateId,
                },
                include: {
                  store: true,
                  createdBy: true,
                },
              });

              await tx.variant.create({
                data: buildDefaultVariantData({
                  ...createdProduct,
                  automaticSkuFilling:
                    supplierSettings?.automaticSkuFilling ?? true,
                  feesPercent: supplierSettings?.ebayFeePercent ?? 13,
                  feesFixed: supplierSettings?.fixedFeeAmount ?? 0.33,
                  profitPercent:
                    supplierSettings?.additionalProfitPercent ?? 0,
                  profitFixed:
                    supplierSettings?.additionalProfitFixed ?? 0,
                  minimumProfit: supplierSettings?.minimumProfit ?? 1,
                }),
              });

              return createdProduct;
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        } catch (error) {
          const isSerializationFailure =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034";

          if (!isSerializationFailure || attempt === maxAttempts) {
            throw error;
          }
        }
      }

      throw new Error("Failed to create draft after concurrent updates.");
    };

    const product = await createProduct();

    invalidateDraftCaches(storeSession.storeId);

    return NextResponse.json(
      { ...product, removedKeywords: filtered.removedKeywords },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof DuplicateAmazonProductError) {
      return NextResponse.json(
        getDuplicateAmazonProductBody(error.existing),
        { status: 409 },
      );
    }

    console.error("[api/products] Failed to create draft", error);
    return NextResponse.json(
      { error: "Failed to save imported product as a draft." },
      { status: 500 }
    );
  }
}

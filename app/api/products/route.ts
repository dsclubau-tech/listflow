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
  if (!images || !Array.isArray(images) || images.length === 0) {
    return NextResponse.json(
      { error: "At least one image is required" },
      { status: 400 }
    );
  }

  // Validate store exists
  const store = await prisma.store.findUnique({
    where: { id: storeSession.storeId },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
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
    const filtered = await applyKeywordFilter(
      title.trim(),
      description.trim(),
      storeSession.storeId
    );
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
        select: { defaultCountry: true, defaultZipcode: true },
      })) ??
      (await prisma.supplierSettings.findFirst({
        where: { storeId: null, supplierName: SUPPLIER_NAME },
        select: { defaultCountry: true, defaultZipcode: true },
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
            title: filtered.title,
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

    // Create product
    const product = await prisma.product.create({
      data: {
        title: filtered.title,
        description: filtered.description,
        price: normalizedPrice,
        quantity: normalizedQuantity,
        category: normalizedCategory,
        categoryName: categoryName || null,
        condition: condition || "New",
        images,
        itemSpecifics: resolvedItemSpecifics,
        status: "DRAFT",
        storeId: storeSession.storeId,
        createdById,
        asin: asin || null,
        amazonPrice: asin ? normalizedPrice : null,
        promotedAdPercent: normalizedPromotedAdPercent,
        shippingPolicyId: policySelection.shippingPolicyId,
        returnPolicyId: policySelection.returnPolicyId,
        paymentPolicyId: policySelection.paymentPolicyId,
        policyTemplateId: policySelection.policyTemplateId,
        templateId: templateId || null,
      },
      include: {
        store: true,
        createdBy: true,
      },
    });

    invalidateDraftCaches(storeSession.storeId);

    return NextResponse.json(
      { ...product, removedKeywords: filtered.removedKeywords },
      { status: 201 }
    );
  } catch (error) {
    console.error("[api/products] Failed to create draft", error);
    return NextResponse.json(
      { error: "Failed to save imported product as a draft." },
      { status: 500 }
    );
  }
}

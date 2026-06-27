import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { applyKeywordFilter } from "@/lib/keyword-filter";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { sanitizeEbayItemSpecifics } from "@/lib/item-specifics";
import { resolveProductPolicySelection } from "@/lib/policy-defaults";
import { invalidateDraftCaches } from "@/lib/cache-tags";

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
  } = body;
  const isIncompleteDraftAllowed = allowIncompleteDraft === true;
  const normalizedPrice =
    price === undefined || price === null || price === "" ? 0 : Number(price);
  const normalizedQuantity =
    quantity === undefined || quantity === null || quantity === ""
      ? 1
      : Number(quantity);
  const normalizedCategory = typeof category === "string" ? category.trim() : "";

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

  // Apply keyword blacklist filter
  const filtered = await applyKeywordFilter(
    title.trim(),
    description.trim(),
    storeSession.storeId
  );
  const createdById = await getInternalUserId();

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
      itemSpecifics: sanitizeEbayItemSpecifics(itemSpecifics),
      status: "DRAFT",
      storeId: storeSession.storeId,
      createdById,
      asin: asin || null,
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

  return NextResponse.json({ ...product, removedKeywords: filtered.removedKeywords }, { status: 201 });
}

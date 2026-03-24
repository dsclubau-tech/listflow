import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { applyKeywordFilter } from "@/lib/keyword-filter";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
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
    templateId,
  } = body;

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
  if (price === undefined || price === null || price < 0) {
    return NextResponse.json(
      { error: "Valid price is required" },
      { status: 400 }
    );
  }
  if (!quantity || quantity < 1) {
    return NextResponse.json(
      { error: "Quantity must be at least 1" },
      { status: 400 }
    );
  }
  if (!category?.trim()) {
    return NextResponse.json(
      { error: "Category is required" },
      { status: 400 }
    );
  }
  if (!storeId) {
    return NextResponse.json(
      { error: "Store is required" },
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
    where: { id: storeId },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
  }

  // Apply keyword blacklist filter
  const filtered = await applyKeywordFilter(title.trim(), description.trim());

  // Create product
  const product = await prisma.product.create({
    data: {
      title: filtered.title,
      description: filtered.description,
      price,
      quantity,
      category: category.trim(),
      categoryName: categoryName || null,
      condition: condition || "New",
      images,
      itemSpecifics: itemSpecifics || {},
      status: "DRAFT",
      storeId,
      createdById: session.user.id,
      asin: asin || null,
      shippingPolicyId: shippingPolicyId || null,
      returnPolicyId: returnPolicyId || null,
      paymentPolicyId: paymentPolicyId || null,
      templateId: templateId || null,
    },
    include: {
      store: true,
      createdBy: true,
    },
  });

  return NextResponse.json({ ...product, removedKeywords: filtered.removedKeywords }, { status: 201 });
}

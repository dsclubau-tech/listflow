import type { ScrapedProduct } from "@/components/AddProductModal";
import { sanitizeEbayItemSpecifics } from "@/lib/item-specifics";

type DraftCreateResponse = {
  id?: string;
  removedKeywords?: string[];
  error?: string;
};

function normalizeTitle(data: ScrapedProduct) {
  if (!data.supplierDefaults?.capitalizeTitle) {
    return data.title;
  }

  return data.title
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function buildItemSpecifics(data: ScrapedProduct) {
  const specifics: Record<string, string> = { ...data.itemSpecifics };

  if (data.brand?.trim() && !specifics.Brand) {
    specifics.Brand = data.brand.trim();
  }

  if (data.variantName?.trim() && !specifics.Variant) {
    specifics.Variant = data.variantName.trim();
  }

  return sanitizeEbayItemSpecifics(specifics);
}

export async function createDraftFromScrapedProduct(data: ScrapedProduct) {
  const defaults = data.supplierDefaults;
  const response = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: normalizeTitle(data),
      description: data.description,
      price: data.price ?? 0,
      quantity: defaults?.quantity ?? 1,
      condition: data.condition || "New",
      category: data.categoryId || "",
      categoryName: data.categoryName || data.category || null,
      images: data.images,
      itemSpecifics: buildItemSpecifics(data),
      asin: data.asin || undefined,
      shippingPolicyId: defaults?.shippingPolicyId || undefined,
      returnPolicyId: defaults?.returnPolicyId || undefined,
      paymentPolicyId: defaults?.paymentPolicyId || undefined,
      allowIncompleteDraft: true,
    }),
  });

  const body = (await response.json()) as DraftCreateResponse;

  if (!response.ok || !body.id) {
    throw new Error(body.error || "Failed to save imported product as a draft.");
  }

  return {
    productId: body.id,
    removedKeywords: body.removedKeywords ?? [],
  };
}

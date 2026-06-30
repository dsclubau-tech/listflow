import type { ScrapedProduct } from "@/components/AddProductModal";
import { sanitizeEbayItemSpecifics } from "@/lib/item-specifics";

type DraftCreateResponse = {
  id?: string;
  removedKeywords?: string[];
  error?: string;
};

function getDraftCreateFallbackError(response: Response, bodyText: string) {
  const trimmed = bodyText.trim();

  if (response.status >= 500) {
    return "Draft save failed on the server. Please try again after redeploying the latest ListFlow fix.";
  }

  if (trimmed) {
    return trimmed.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 240);
  }

  return "Failed to save imported product as a draft.";
}

async function readDraftCreateResponse(response: Response) {
  const bodyText = await response.text();

  if (!bodyText.trim()) {
    return {} as DraftCreateResponse;
  }

  try {
    return JSON.parse(bodyText) as DraftCreateResponse;
  } catch {
    return {
      error: getDraftCreateFallbackError(response, bodyText),
    } satisfies DraftCreateResponse;
  }
}

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
  if (data.price === null || data.price <= 0) {
    throw new Error(
      "Amazon product was found, but ListFlow could not read a valid price. No draft was created."
    );
  }

  const defaults = data.supplierDefaults;
  const response = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: normalizeTitle(data),
      description: data.description,
      price: data.price,
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
      policyTemplateId: defaults?.policyTemplateId || undefined,
      allowIncompleteDraft: true,
    }),
  });

  const body = await readDraftCreateResponse(response);

  if (!response.ok || !body.id) {
    throw new Error(body.error || "Failed to save imported product as a draft.");
  }

  return {
    productId: body.id,
    removedKeywords: body.removedKeywords ?? [],
  };
}

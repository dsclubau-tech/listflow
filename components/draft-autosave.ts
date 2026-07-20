import type { ScrapedProduct } from "@/components/AddProductModal";
import {
  inferBrandItemSpecific,
  inferSizeItemSpecific,
  inferTypeItemSpecific,
  sanitizeEbayItemSpecifics,
} from "@/lib/item-specifics";
import { applyEbayLocationMetadata } from "@/lib/ebay-location";
import { dedupeProductImages } from "@/lib/product-images";
import {
  applyTitleCase,
  normalizeFullProductTitle,
  toEbayListingTitle,
} from "@/lib/product-title";
import type { ExistingProductConflict } from "@/types/product-duplicate";

type DraftCreateResponse = {
  id?: string;
  removedKeywords?: string[];
  error?: string;
  code?: string;
  existing?: ExistingProductConflict;
};

export class DuplicateDraftError extends Error {
  readonly existing: ExistingProductConflict;

  constructor(message: string, existing: ExistingProductConflict) {
    super(message);
    this.name = "DuplicateDraftError";
    this.existing = existing;
  }
}

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
  const sourceTitle = data.fullTitle || data.title;
  if (!data.supplierDefaults?.capitalizeTitle) {
    return normalizeFullProductTitle(sourceTitle);
  }

  return applyTitleCase(normalizeFullProductTitle(sourceTitle));
}

function buildItemSpecifics(data: ScrapedProduct) {
  const sourceTitle = data.fullTitle || data.title;
  const specifics: Record<string, string> = {
    ...(data.supplierDefaults?.defaultItemSpecifics ?? {}),
    ...data.itemSpecifics,
  };

  const inferredBrand = inferBrandItemSpecific({
    itemSpecifics: specifics,
    brand: data.brand,
  });
  if (inferredBrand) {
    specifics.Brand = inferredBrand;
  }

  if (data.variantName?.trim() && !specifics.Variant) {
    specifics.Variant = data.variantName.trim();
  }

  if (!specifics.Type) {
    const inferredType = inferTypeItemSpecific({
      title: sourceTitle,
      categoryName: data.categoryName || data.category,
      itemSpecifics: specifics,
    });
    if (inferredType) {
      specifics.Type = inferredType;
    }
  }

  if (!specifics.Size) {
    const inferredSize = inferSizeItemSpecific({
      title: sourceTitle,
      categoryName: data.categoryName || data.category,
      itemSpecifics: specifics,
    });
    if (inferredSize) {
      specifics.Size = inferredSize;
    }
  }

  return sanitizeEbayItemSpecifics(
    applyEbayLocationMetadata(specifics, {
      country: data.supplierDefaults?.country,
      postalCode: data.supplierDefaults?.zipcode,
    }),
  );
}

export async function createDraftFromScrapedProduct(data: ScrapedProduct) {
  if (data.price === null || data.price <= 0) {
    throw new Error(
      "Amazon product was found, but ListFlow could not read a valid price. No draft was created."
    );
  }

  const defaults = data.supplierDefaults;
  const images = dedupeProductImages(data.images);
  if (images.length === 0) {
    throw new Error("Amazon product was found, but no usable product images were found.");
  }

  const response = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: toEbayListingTitle(normalizeTitle(data)),
      fullTitle: normalizeTitle(data),
      description: data.description,
      price: data.price,
      quantity: defaults?.quantity ?? 1,
      condition: data.condition || "New",
      category: data.categoryId || "",
      categoryName: data.categoryName || data.category || null,
      images,
      itemSpecifics: buildItemSpecifics(data),
      asin: data.asin || undefined,
      amazonPriceTrackingMode: data.amazonPriceTrackingMode ?? "REGULAR",
      shippingPolicyId: defaults?.shippingPolicyId || undefined,
      returnPolicyId: defaults?.returnPolicyId || undefined,
      paymentPolicyId: defaults?.paymentPolicyId || undefined,
      policyTemplateId: defaults?.policyTemplateId || undefined,
      allowIncompleteDraft: true,
    }),
  });

  const body = await readDraftCreateResponse(response);

  if (!response.ok || !body.id) {
    if (body.code === "DUPLICATE_ASIN" && body.existing) {
      throw new DuplicateDraftError(
        body.error || "This Amazon product already exists.",
        body.existing,
      );
    }

    throw new Error(body.error || "Failed to save imported product as a draft.");
  }

  return {
    productId: body.id,
    removedKeywords: body.removedKeywords ?? [],
  };
}

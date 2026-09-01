import "server-only";

import { Prisma } from "@/app/generated/prisma/client";
import { ProductStatus } from "@/app/generated/prisma/enums";
import { applyKeywordFilter } from "@/lib/keyword-filter";
import { normalizeItemSpecifics, sanitizeEbayItemSpecifics } from "@/lib/item-specifics";
import { resolveEbayLocationMetadata } from "@/lib/ebay-location";
import { resolveProductPolicySelection } from "@/lib/policy-defaults";
import { prisma } from "@/lib/prisma";
import { calculateSellPrice } from "@/lib/variant-pricing";

export type BulkEditField =
  | "feesPercent"
  | "feesFixed"
  | "profitFixed"
  | "profitPercent"
  | "roundCents"
  | "quantity"
  | "title"
  | "brand"
  | "location"
  | "templateId"
  | "dispatchTimeMax"
  | "shippingPolicyId"
  | "returnPolicyId"
  | "paymentPolicyId"
  | "policyTemplateId";

type BulkEditTitleMode = "set" | "prefix" | "suffix" | "findReplace";

export type NormalizedBulkEditOperation =
  | { field: "feesPercent" | "feesFixed" | "profitFixed" | "profitPercent"; value: number }
  | { field: "roundCents"; value: boolean }
  | { field: "quantity"; value: number }
  | { field: "title"; mode: BulkEditTitleMode; value: string; replaceValue?: string; confirmed?: boolean }
  | { field: "brand"; value: string }
  | { field: "location"; value: { location: string; postalCode: string; locationText?: string } }
  | { field: "templateId"; value: string | null }
  | { field: "dispatchTimeMax"; value: number }
  | { field: "shippingPolicyId" | "returnPolicyId" | "paymentPolicyId" | "policyTemplateId"; value: string | null };

export type BulkEditSkippedProduct = {
  productId: string;
  title: string;
  reason: string;
};

type ApplyBulkProductEditsInput = {
  storeId: string;
  productIds: unknown[];
  operations: unknown;
};

const TITLE_MAX_LENGTH = 80;
const MAX_PRODUCT_IDS = 500;
const COUNTRY_METADATA: Record<
  string,
  { country: string; currency: string; site: string }
> = {
  Australia: { country: "AU", currency: "AUD", site: "Australia" },
  "United States": { country: "US", currency: "USD", site: "US" },
  "United Kingdom": { country: "GB", currency: "GBP", site: "UK" },
};

function normalizeProductIds(productIds: unknown[]) {
  if (!Array.isArray(productIds)) {
    throw new Error("productIds must be an array.");
  }

  const normalized = Array.from(
    new Set(
      productIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean)
    )
  );

  if (normalized.length === 0) {
    throw new Error("Select at least one product to bulk edit.");
  }

  if (normalized.length > MAX_PRODUCT_IDS) {
    throw new Error(`Bulk edit supports up to ${MAX_PRODUCT_IDS} products at a time.`);
  }

  return normalized;
}

function readNumber(value: unknown, label: string) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return numeric;
}

function readNonNegativeNumber(value: unknown, label: string) {
  const numeric = readNumber(value, label);

  if (numeric < 0) {
    throw new Error(`${label} must be 0 or greater.`);
  }

  return numeric;
}

function readOptionalString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Policy values must be strings or null.");
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function readRawString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text.`);
  }

  return value;
}

function normalizeTitleOperation(
  source: Record<string, unknown>,
): NormalizedBulkEditOperation {
  const mode = source.mode;

  if (
    mode !== "set" &&
    mode !== "prefix" &&
    mode !== "suffix" &&
    mode !== "findReplace"
  ) {
    throw new Error("Title edit mode is invalid.");
  }

  if (mode === "findReplace") {
    const value = readString(source.value, "Find text");
    return {
      field: "title",
      mode,
      value,
      replaceValue: readRawString(source.replaceValue ?? "", "Replace text"),
      confirmed: source.confirmed === true,
    };
  }

  return {
    field: "title",
    mode,
    value: readString(source.value, "Title text"),
    confirmed: source.confirmed === true,
  };
}

function normalizeLocationOperation(value: unknown): NormalizedBulkEditOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Location must include a country and postcode.");
  }

  const source = value as Record<string, unknown>;
  const location = readString(source.location, "Location");
  const postalCode = readString(source.postalCode, "Postcode");
  const locationText =
    typeof source.locationText === "string" ? source.locationText.trim() : undefined;

  if (!COUNTRY_METADATA[location]) {
    throw new Error("Location must be Australia, United States, or United Kingdom.");
  }

  return {
    field: "location",
    value: { location, postalCode, locationText },
  };
}

function readIntegerInRange(value: unknown, label: string, min: number, max: number) {
  const parsed = readNumber(value, label);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  }

  return parsed;
}

export function normalizeBulkEditOperations(
  operations: unknown,
): NormalizedBulkEditOperation[] {
  if (!Array.isArray(operations)) {
    throw new Error("operations must be an array.");
  }

  if (operations.length === 0) {
    throw new Error("Add at least one item to edit.");
  }

  return operations.map((operation) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      throw new Error("Each bulk edit operation must be an object.");
    }

    const source = operation as Record<string, unknown>;

    switch (source.field) {
      case "feesPercent":
        return { field: "feesPercent", value: readNonNegativeNumber(source.value, "Fees %") };
      case "feesFixed":
        return { field: "feesFixed", value: readNonNegativeNumber(source.value, "Fees $") };
      case "profitFixed":
        return {
          field: "profitFixed",
          value: readNonNegativeNumber(source.value, "Additional profit $"),
        };
      case "profitPercent":
        return {
          field: "profitPercent",
          value: readNonNegativeNumber(source.value, "Additional profit %"),
        };
      case "roundCents":
        return { field: "roundCents", value: source.value === true };
      case "quantity": {
        const quantity = readNumber(source.value, "Quantity");
        if (!Number.isInteger(quantity) || quantity < 0) {
          throw new Error("Quantity must be a whole number of 0 or greater.");
        }
        return { field: "quantity", value: quantity };
      }
      case "title":
        return normalizeTitleOperation(source);
      case "brand":
        return { field: "brand", value: readString(source.value, "Brand") };
      case "location":
        return normalizeLocationOperation(source.value);
      case "templateId":
        return { field: "templateId", value: readOptionalString(source.value) };
      case "dispatchTimeMax":
        return {
          field: "dispatchTimeMax",
          value: readIntegerInRange(source.value, "Additional handling days", 0, 30),
        };
      case "shippingPolicyId":
      case "returnPolicyId":
      case "paymentPolicyId":
      case "policyTemplateId":
        return {
          field: source.field,
          value: readOptionalString(source.value),
        };
      case "globalShipping":
      case "shippingMethod":
      case "shippingPrice":
        throw new Error(`${fieldLabel(source.field)} bulk edit is not available yet.`);
      default:
        throw new Error("Unsupported bulk edit field.");
    }
  });
}

function fieldLabel(field: unknown) {
  if (field === "globalShipping") return "Global Shipping";
  if (field === "shippingMethod") return "Shipping method";
  if (field === "shippingPrice") return "Shipping price";
  return "This field";
}

function applyTitleOperation(title: string, operation: Extract<NormalizedBulkEditOperation, { field: "title" }>) {
  if (operation.mode === "set") {
    return operation.value;
  }

  if (operation.mode === "prefix") {
    return `${operation.value}${title}`;
  }

  if (operation.mode === "suffix") {
    return `${title}${operation.value}`;
  }

  return title.split(operation.value).join(operation.replaceValue ?? "");
}

function toDecimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

function buildVariantUpdate(
  variant: {
    buyPrice: Prisma.Decimal;
    feesPercent: number;
    feesFixed: number;
    profitPercent: number;
    profitFixed: number;
    roundCents: number | null;
  },
  operations: NormalizedBulkEditOperation[],
) {
  let feesPercent = variant.feesPercent;
  let feesFixed = variant.feesFixed;
  let profitPercent = variant.profitPercent;
  let profitFixed = variant.profitFixed;
  let roundCents = variant.roundCents;
  let changed = false;
  const data: Prisma.VariantUpdateInput = {};

  for (const operation of operations) {
    if (operation.field === "feesPercent") {
      feesPercent = operation.value;
      data.feesPercent = operation.value;
      changed = true;
    } else if (operation.field === "feesFixed") {
      feesFixed = operation.value;
      data.feesFixed = operation.value;
      changed = true;
    } else if (operation.field === "profitPercent") {
      profitPercent = operation.value;
      data.profitPercent = operation.value;
      changed = true;
    } else if (operation.field === "profitFixed") {
      profitFixed = operation.value;
      data.profitFixed = operation.value;
      changed = true;
    } else if (operation.field === "roundCents") {
      roundCents = operation.value ? 0.99 : null;
      data.roundCents = roundCents;
      changed = true;
    } else if (operation.field === "quantity") {
      data.quantity = operation.value;
      changed = true;
    }
  }

  if (changed) {
    data.sellPrice = toDecimal(
      calculateSellPrice({
        buyPrice: variant.buyPrice.toNumber(),
        feesPercent,
        feesFixed,
        profitPercent,
        profitFixed,
        roundCents,
      })
    );
  }

  return { changed, data, sellPrice: data.sellPrice };
}

function hasVariantOperation(operations: NormalizedBulkEditOperation[]) {
  return operations.some((operation) =>
    [
      "feesPercent",
      "feesFixed",
      "profitPercent",
      "profitFixed",
      "roundCents",
      "quantity",
    ].includes(operation.field)
  );
}

function getPolicyPatch(operations: NormalizedBulkEditOperation[]) {
  const patch: Partial<{
    shippingPolicyId: string | null;
    returnPolicyId: string | null;
    paymentPolicyId: string | null;
    policyTemplateId: string | null;
  }> = {};

  for (const operation of operations) {
    if (
      operation.field === "shippingPolicyId" ||
      operation.field === "returnPolicyId" ||
      operation.field === "paymentPolicyId" ||
      operation.field === "policyTemplateId"
    ) {
      patch[operation.field] = operation.value;
    }
  }

  return patch;
}

export async function applyBulkProductEdits(input: ApplyBulkProductEditsInput) {
  const productIds = normalizeProductIds(input.productIds);
  const operations = normalizeBulkEditOperations(input.operations);
  const hasExactTitleSet =
    productIds.length > 1 &&
    operations.some(
      (operation) =>
        operation.field === "title" &&
        operation.mode === "set" &&
        operation.confirmed !== true
    );

  if (hasExactTitleSet) {
    throw new Error("Confirm exact title replacement before updating multiple products.");
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId: input.storeId },
    include: {
      variants: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const skipped: BulkEditSkippedProduct[] = [];
  const updatedProductIds: string[] = [];
  const hasVariantOps = hasVariantOperation(operations);
  const hasDescriptionTemplateOperation = operations.some(
    (operation) => operation.field === "templateId",
  );
  let updatedVariantCount = 0;

  for (const productId of productIds) {
    const product = productById.get(productId);

    if (!product) {
      skipped.push({ productId, title: "(missing)", reason: "Product was not found." });
      continue;
    }

    if (
      product.status !== ProductStatus.IMPORTED &&
      product.status !== ProductStatus.ON_HOLD
    ) {
      skipped.push({
        productId,
        title: product.title,
        reason: "Product is not imported or on hold.",
      });
      continue;
    }

    if (!product.ebayItemId) {
      skipped.push({
        productId,
        title: product.title,
        reason: "Product has no eBay Item ID.",
      });
      continue;
    }

    if (hasVariantOps && product.variants.length === 0) {
      skipped.push({
        productId,
        title: product.title,
        reason: "Product has no variants to update.",
      });
      continue;
    }

    let title = product.title;
    let description = product.description;
    let itemSpecifics = normalizeItemSpecifics(product.itemSpecifics);
    const productData: Prisma.ProductUpdateInput = {};
    const policyPatch = getPolicyPatch(operations);

    try {
      for (const operation of operations) {
        if (operation.field === "title") {
          title = applyTitleOperation(title, operation).replace(/\s{2,}/g, " ").trim();

          if (!title) {
            throw new Error("Title cannot be empty.");
          }

          if (title.length > TITLE_MAX_LENGTH) {
            throw new Error(`Title must be ${TITLE_MAX_LENGTH} characters or fewer.`);
          }

          const filtered = await applyKeywordFilter(title, description, input.storeId);
          title = filtered.title;
          description = filtered.description;

          if (!title) {
            throw new Error("Title cannot be empty after keyword filtering.");
          }

          productData.title = title;
          productData.description = description;
        } else if (operation.field === "brand") {
          itemSpecifics = sanitizeEbayItemSpecifics({
            ...itemSpecifics,
            Brand: operation.value,
          });
          productData.itemSpecifics = itemSpecifics;
        } else if (operation.field === "location") {
          const metadata = COUNTRY_METADATA[operation.value.location];
          const resolvedLocation =
            operation.value.locationText ||
            resolveEbayLocationMetadata({
              country: metadata.country,
              postalCode: operation.value.postalCode,
            }).location;

          itemSpecifics = sanitizeEbayItemSpecifics({
            ...itemSpecifics,
            _Location: resolvedLocation,
            _PostalCode: operation.value.postalCode,
            _Country: metadata.country,
            _Currency: metadata.currency,
            _Site: metadata.site,
          });
          productData.itemSpecifics = itemSpecifics;
        } else if (operation.field === "dispatchTimeMax") {
          itemSpecifics = sanitizeEbayItemSpecifics({
            ...itemSpecifics,
            _DispatchTimeMax: String(operation.value),
          });
          productData.itemSpecifics = itemSpecifics;
        } else if (operation.field === "templateId") {
          if (operation.value) {
            const template = await prisma.descriptionTemplate.findFirst({
              where: { id: operation.value, storeId: input.storeId },
              select: { id: true },
            });

            if (!template) {
              throw new Error("Description template not found.");
            }
          }

          productData.templateId = operation.value;
        } else if (operation.field === "quantity") {
          productData.quantity = operation.value;
          if (operation.value === 0) {
            productData.status = ProductStatus.ON_HOLD;
            productData.holdReason = "Listing quantity was set to 0.";
          } else if (product.status === ProductStatus.ON_HOLD) {
            productData.status = ProductStatus.IMPORTED;
            productData.holdReason = null;
          }
        }
      }

      if (Object.keys(policyPatch).length > 0) {
        const policySelection = await resolveProductPolicySelection(
          input.storeId,
          {
            shippingPolicyId:
              policyPatch.shippingPolicyId !== undefined
                ? policyPatch.shippingPolicyId
                : product.shippingPolicyId,
            returnPolicyId:
              policyPatch.returnPolicyId !== undefined
                ? policyPatch.returnPolicyId
                : product.returnPolicyId,
            paymentPolicyId:
              policyPatch.paymentPolicyId !== undefined
                ? policyPatch.paymentPolicyId
                : product.paymentPolicyId,
          },
          policyPatch.policyTemplateId !== undefined
            ? policyPatch.policyTemplateId
            : product.policyTemplateId
        );

        productData.shippingPolicyId = policySelection.shippingPolicyId;
        productData.returnPolicyId = policySelection.returnPolicyId;
        productData.paymentPolicyId = policySelection.paymentPolicyId;
        productData.policyTemplateId = policySelection.policyTemplateId;
        if (
          policyPatch.policyTemplateId !== undefined &&
          !hasDescriptionTemplateOperation
        ) {
          productData.templateId = policySelection.descriptionTemplateId;
        }
      }

      await prisma.$transaction(async (tx) => {
        let primarySellPrice: Prisma.Decimal | undefined;

        if (hasVariantOps) {
          for (const [index, variant] of product.variants.entries()) {
            const update = buildVariantUpdate(variant, operations);

            if (!update.changed) {
              continue;
            }

            await tx.variant.update({
              where: { id: variant.id },
              data: update.data,
            });
            updatedVariantCount += 1;

            if (index === 0 && update.sellPrice instanceof Prisma.Decimal) {
              primarySellPrice = update.sellPrice;
            }
          }
        }

        if (primarySellPrice) {
          productData.price = primarySellPrice;
        }

        if (Object.keys(productData).length > 0) {
          await tx.product.update({
            where: { id: product.id },
            data: {
              ...productData,
              errorMessage: null,
            },
          });
        }
      });

      updatedProductIds.push(product.id);
    } catch (error) {
      skipped.push({
        productId,
        title: product.title,
        reason: error instanceof Error ? error.message : "Bulk edit failed for this product.",
      });
    }
  }

  return {
    productIds: updatedProductIds,
    updatedProducts: updatedProductIds.length,
    updatedVariants: updatedVariantCount,
    operationFields: Array.from(new Set(operations.map((operation) => operation.field))),
    skipped,
  };
}

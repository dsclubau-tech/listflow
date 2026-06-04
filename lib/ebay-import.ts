import "server-only";

import { XMLParser } from "fast-xml-parser";
import {
  Prisma,
  ProductStatus,
  VariantStatus,
} from "@/app/generated/prisma/client";
import { callEbayGetSellerList } from "@/lib/ebay";
import { buildGetSellerListXML } from "@/lib/ebay-xml";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export interface EbayImportOptions {
  storeId: string;
  storeNumber: 1 | 2 | 3;
  userId: string;
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportProgress {
  page: number;
  totalPages: number;
  created: number;
  skipped: number;
  failed: number;
}

export interface EbayImportResult {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  errors: Array<{ itemId: string; title: string; error: string }>;
}

type EbayNode = Record<string, unknown>;

interface SellerListPage {
  items: EbayNode[];
  totalPages: number;
}

interface NameValuePair {
  name: string;
  values: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  trimValues: true,
});

const ASIN_PATTERN = /^B0[A-Z0-9]{8,}$/i;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function isNode(value: unknown): value is EbayNode {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPath(source: unknown, ...path: string[]): unknown {
  let current = source;

  for (const key of path) {
    if (!isNode(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(toText).filter(Boolean).join(", ");
  }

  if (isNode(value)) {
    if ("#text" in value) {
      return toText(value["#text"]);
    }

    if ("__cdata" in value) {
      return toText(value.__cdata);
    }
  }

  return "";
}

function getString(source: unknown, ...path: string[]) {
  return toText(getPath(source, ...path)).trim();
}

function normalizeAsinSku(sku: string) {
  const asin = sku.trim().toUpperCase();
  return ASIN_PATTERN.test(asin) ? asin : null;
}

function extractAsinFromSku(item: EbayNode): string | null {
  const itemAsin = normalizeAsinSku(getString(item, "SKU"));

  if (itemAsin) {
    return itemAsin;
  }

  const variations = asArray(getPath(item, "Variations", "Variation")).filter(isNode);
  const firstVariationAsin = normalizeAsinSku(getString(variations[0], "SKU"));

  return firstVariationAsin;
}

function toNumber(value: unknown): number | null {
  const raw = toText(value).replace(/,/g, "").trim();

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.floor(parsed);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function getPictureUrls(source: unknown) {
  const directUrls = asArray(getPath(source, "PictureURL"));
  const pictureDetailUrls = asArray(getPath(source, "PictureDetails", "PictureURL"));

  return uniqueStrings([...directUrls, ...pictureDetailUrls].map(toText));
}

function readNameValuePairs(source: unknown): NameValuePair[] {
  const nameValueLists = asArray(getPath(source, "NameValueList"));

  return nameValueLists
    .filter(isNode)
    .map((entry) => {
      const name = getString(entry, "Name");
      const values = uniqueStrings(asArray(getPath(entry, "Value")).map(toText));

      return { name, values };
    })
    .filter((entry) => entry.name && entry.values.length > 0);
}

function getItemSpecifics(item: EbayNode) {
  const specifics: Record<string, string> = {};
  const pairs = readNameValuePairs(getPath(item, "ItemSpecifics"));

  for (const pair of pairs) {
    const value = pair.values.join(", ");
    specifics[pair.name] = specifics[pair.name]
      ? `${specifics[pair.name]}, ${value}`
      : value;
  }

  return specifics;
}

function getRequiredPrice(value: unknown) {
  const price = toNumber(value);

  if (price === null || price <= 0) {
    throw new Error(`Invalid price: $${(price ?? 0).toFixed(2)}`);
  }

  return Number(price.toFixed(2));
}

function getAvailableQuantity(source: unknown) {
  const quantityAvailable = toInteger(getPath(source, "QuantityAvailable"));

  if (quantityAvailable !== null) {
    return Math.max(0, quantityAvailable);
  }

  const quantity = toInteger(getPath(source, "Quantity"));
  const quantitySold = toInteger(getPath(source, "SellingStatus", "QuantitySold")) ?? 0;

  if (quantity === null) {
    return 0;
  }

  return Math.max(0, quantity - quantitySold);
}

function getCondition(item: EbayNode) {
  const conditionId = getString(item, "ConditionID");
  return conditionId === "1000" ? "New" : "Used";
}

function getPolicyId(item: EbayNode, profileName: string, fieldName: string) {
  return getString(item, "SellerProfiles", profileName, fieldName) || null;
}

function getVariationSpecificPairs(variation: EbayNode) {
  return readNameValuePairs(getPath(variation, "VariationSpecifics"));
}

function buildVariationTitle(pairs: NameValuePair[]) {
  const title = pairs
    .map((pair) => `${pair.name}: ${pair.values.join("/")}`)
    .join(", ");

  return title || "Variation";
}

function getVariationPictures(
  item: EbayNode,
  variation: EbayNode,
  pairs: NameValuePair[],
) {
  const directImages = getPictureUrls(variation);

  if (directImages.length > 0) {
    return directImages;
  }

  const pictureGroups = asArray(getPath(item, "Variations", "Pictures")).filter(isNode);

  for (const group of pictureGroups) {
    const specificName = getString(group, "VariationSpecificName");
    const matchingPair = pairs.find((pair) => pair.name === specificName);

    if (!matchingPair) {
      continue;
    }

    const pictureSets = asArray(getPath(group, "VariationSpecificPictureSet")).filter(isNode);

    for (const pictureSet of pictureSets) {
      const specificValue = getString(pictureSet, "VariationSpecificValue");

      if (matchingPair.values.includes(specificValue)) {
        return getPictureUrls(pictureSet);
      }
    }
  }

  return [];
}

function buildVariantData(
  input: {
    sku: string | null;
    title: string;
    images: string[];
    price: number;
    quantity: number;
  },
): Prisma.VariantCreateWithoutProductInput {
  return {
    sku: input.sku,
    title: input.title,
    images: input.images,
    buyPrice: input.price,
    feesPercent: 0,
    feesFixed: 0,
    profitPercent: 0,
    profitFixed: 0,
    sellPrice: input.price,
    quantity: input.quantity,
    status: VariantStatus.IN_STOCK,
    automation: null,
    includeShipping: true,
    allowMarketplace: true,
    roundCents: null,
    itemSpecifics: {},
  };
}

function mapVariations(item: EbayNode): Prisma.VariantCreateWithoutProductInput[] {
  const variations = asArray(getPath(item, "Variations", "Variation")).filter(isNode);

  if (variations.length === 0) {
    const price = getRequiredPrice(getPath(item, "StartPrice"));

    return [
      buildVariantData({
        sku: getString(item, "SKU") || null,
        title: "Default",
        images: [],
        price,
        quantity: getAvailableQuantity(item),
      }),
    ];
  }

  return variations.map((variation) => {
    const pairs = getVariationSpecificPairs(variation);
    const price = getRequiredPrice(getPath(variation, "StartPrice"));

    return buildVariantData({
      sku: getString(variation, "SKU") || null,
      title: buildVariationTitle(pairs),
      images: getVariationPictures(item, variation, pairs),
      price,
      quantity: getAvailableQuantity(variation),
    });
  });
}

function getProductPrice(item: EbayNode, variants: Prisma.VariantCreateWithoutProductInput[]) {
  const firstVariantPrice = variants[0]?.sellPrice;

  if (firstVariantPrice !== undefined) {
    return getRequiredPrice(firstVariantPrice);
  }

  return getRequiredPrice(getPath(item, "StartPrice"));
}

function mapEbayItemToProduct(
  item: EbayNode,
  storeId: string,
  userId: string,
): Prisma.ProductCreateInput {
  const variants = mapVariations(item);
  const categoryId = getString(item, "PrimaryCategory", "CategoryID");
  const title = getString(item, "Title") || "(no title)";
  const quantity = getAvailableQuantity(item);

  return {
    title,
    description: toText(getPath(item, "Description")),
    price: getProductPrice(item, variants),
    quantity,
    category: categoryId,
    categoryName: getString(item, "PrimaryCategory", "CategoryName") || null,
    condition: getCondition(item),
    images: getPictureUrls(item),
    itemSpecifics: getItemSpecifics(item),
    status: ProductStatus.IMPORTED,
    ebayItemId: getString(item, "ItemID"),
    errorMessage: null,
    asin: extractAsinFromSku(item),
    amazonPrice: null,
    shippingPolicyId: getPolicyId(
      item,
      "SellerShippingProfile",
      "ShippingProfileID",
    ),
    returnPolicyId: getPolicyId(item, "SellerReturnProfile", "ReturnProfileID"),
    paymentPolicyId: getPolicyId(
      item,
      "SellerPaymentProfile",
      "PaymentProfileID",
    ),
    policyTemplateId: null,
    templateId: null,
    store: { connect: { id: storeId } },
    createdBy: { connect: { id: userId } },
    variants: { create: variants },
  };
}

function formatEbayErrors(errors: unknown) {
  const messages = asArray(errors)
    .map((error) => {
      if (!isNode(error)) {
        return toText(error);
      }

      const shortMessage = getString(error, "ShortMessage");
      const longMessage = getString(error, "LongMessage");
      const code = getString(error, "ErrorCode");
      const message = shortMessage || longMessage || "Unknown eBay error";

      return code ? `${message} (${code})` : message;
    })
    .filter(Boolean);

  return messages.length > 0 ? messages.join("; ") : "Unknown eBay error";
}

async function fetchSellerListPage(
  storeNumber: 1 | 2 | 3,
  page: number,
): Promise<SellerListPage> {
  const xml = buildGetSellerListXML(page);
  const xmlText = await callEbayGetSellerList(xml, storeNumber);
  const parsed = parser.parse(xmlText) as EbayNode;
  const response = getPath(parsed, "GetSellerListResponse");

  if (!isNode(response)) {
    throw new Error("Invalid GetSellerList response from eBay");
  }

  const ack = getString(response, "Ack");

  if (ack !== "Success" && ack !== "Warning") {
    throw new Error(formatEbayErrors(getPath(response, "Errors")));
  }

  const totalPages = Math.max(
    1,
    toInteger(getPath(response, "PaginationResult", "TotalNumberOfPages")) ?? 1,
  );
  const items = asArray(getPath(response, "ItemArray", "Item")).filter(isNode);

  return { items, totalPages };
}

function isImportableListing(item: EbayNode) {
  const listingType = getString(item, "ListingType");
  return listingType === "FixedPriceItem" || listingType === "StoresFixedPrice";
}

async function importSingleItem(
  item: EbayNode,
  storeId: string,
  userId: string,
): Promise<boolean> {
  const itemId = getString(item, "ItemID");

  if (!itemId) {
    throw new Error("Listing is missing ItemID");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${storeId}), hashtext(${itemId}))
    `;

    const existing = await tx.product.findFirst({
      where: { ebayItemId: itemId, storeId },
      select: { id: true },
    });

    if (existing) {
      return false;
    }

    await tx.product.create({
      data: mapEbayItemToProduct(item, storeId, userId),
    });

    return true;
  });
}

export async function importEbayListings(
  options: EbayImportOptions,
): Promise<EbayImportResult> {
  const result: EbayImportResult = {
    total: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  let page = 1;
  let totalPages = 1;

  logger.info("ebay-import/importEbayListings", "Starting eBay listing import", {
    storeId: options.storeId,
    storeNumber: options.storeNumber,
    userId: options.userId,
  });

  do {
    const response = await fetchSellerListPage(options.storeNumber, page);
    totalPages = response.totalPages;

    for (const item of response.items) {
      result.total += 1;

      if (!isImportableListing(item)) {
        result.skipped += 1;
        continue;
      }

      try {
        const wasCreated = await importSingleItem(
          item,
          options.storeId,
          options.userId,
        );

        if (wasCreated) {
          result.created += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          itemId: getString(item, "ItemID") || "(missing)",
          title: getString(item, "Title") || "(no title)",
          error: getErrorMessage(error),
        });
      }
    }

    options.onProgress?.({
      page,
      totalPages,
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
    });

    if (page < totalPages) {
      await delay(500);
    }

    page += 1;
  } while (page <= totalPages);

  logger.info("ebay-import/importEbayListings", "Finished eBay listing import", {
    storeId: options.storeId,
    storeNumber: options.storeNumber,
    ...result,
  });

  return result;
}

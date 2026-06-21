import "server-only";

import { XMLParser } from "fast-xml-parser";
import {
  Prisma,
  ProductStatus,
  VariantStatus,
} from "@/app/generated/prisma/client";
import { callEbayGetItem, callEbayGetSellerList } from "@/lib/ebay";
import {
  buildGetItemXML,
  buildGetSellerListXML,
  buildGetSellerListIdsXML,
} from "@/lib/ebay-xml";
import { logger } from "@/lib/logger";
import {
  getStorePolicyDefaults,
  policyIdsMatch,
  type ResolvedPolicyDefaults,
} from "@/lib/policy-defaults";
import { prisma } from "@/lib/prisma";

export interface EbayImportOptions {
  storeId: string;
  storeNumber: 1 | 2 | 3;
  userId: string;
  quantity: number;
  onProgress?: (progress: ImportProgress) => void | Promise<void>;
}

export interface ImportProgress {
  processed: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  currentItemId?: string;
}

export interface EbayImportStats {
  activeListings: number;
  alreadyImported: number;
  remaining: number;
  staleInListFlow: number;
  fetchedAt: string | null;
}

export interface EbayImportResult {
  requested: number;
  activeListings: number;
  alreadyImported: number;
  remainingBeforeImport: number;
  remainingAfterImport: number;
  created: number;
  skipped: number;
  failed: number;
  rateLimited: boolean;
  errors: Array<{ itemId: string; title: string; error: string }>;
}

type EbayNode = Record<string, unknown>;

interface SellerListIdPage {
  itemIds: string[];
  totalPages: number;
  hasMoreItems: boolean;
}

interface SellerListDetailPage {
  items: EbayNode[];
  totalPages: number;
  hasMoreItems: boolean;
}

interface NameValuePair {
  name: string;
  values: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: {
    maxTotalExpansions: 20000,
    maxExpandedLength: 5_000_000,
  },
  removeNSPrefix: true,
  trimValues: true,
});

const ASIN_PATTERN = /\bB0[A-Z0-9]{8}\b/i;
const IMPORT_STATS_CACHE_TTL_MS = 10 * 60 * 1000;

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

function getItemDescription(item: EbayNode) {
  return toText(getPath(item, "Description")).trim();
}

function extractAsinFromText(value: string) {
  const match = value.toUpperCase().match(ASIN_PATTERN);
  return match ? match[0] : null;
}

function extractAsinFromSpecifics(specifics: Record<string, string>) {
  const preferredKeys = new Set([
    "asin",
    "amazonasin",
    "amazonitemid",
    "amazonitemnumber",
  ]);

  for (const [key, value] of Object.entries(specifics)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (preferredKeys.has(normalizedKey)) {
      const asin = extractAsinFromText(value);

      if (asin) {
        return asin;
      }
    }
  }

  for (const value of Object.values(specifics)) {
    const asin = extractAsinFromText(value);

    if (asin) {
      return asin;
    }
  }

  return null;
}

function extractAsin(item: EbayNode, specifics: Record<string, string>): string | null {
  const itemAsin = extractAsinFromText(getString(item, "SKU"));

  if (itemAsin) {
    return itemAsin;
  }

  const variations = asArray(getPath(item, "Variations", "Variation")).filter(isNode);

  for (const variation of variations) {
    const variationAsin = extractAsinFromText(getString(variation, "SKU"));

    if (variationAsin) {
      return variationAsin;
    }
  }

  const specificsAsin = extractAsinFromSpecifics(specifics);

  if (specificsAsin) {
    return specificsAsin;
  }

  return extractAsinFromText(toText(getPath(item, "Description")));
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
  policyDefaults: ResolvedPolicyDefaults,
): Prisma.ProductCreateInput {
  const variants = mapVariations(item);
  const categoryId = getString(item, "PrimaryCategory", "CategoryID");
  const title = getString(item, "Title") || "(no title)";
  const quantity = getAvailableQuantity(item);
  const itemSpecifics = getItemSpecifics(item);
  const policyIds = {
    shippingPolicyId:
      getPolicyId(item, "SellerShippingProfile", "ShippingProfileID") ??
      policyDefaults.shippingPolicyId,
    returnPolicyId:
      getPolicyId(item, "SellerReturnProfile", "ReturnProfileID") ??
      policyDefaults.returnPolicyId,
    paymentPolicyId:
      getPolicyId(item, "SellerPaymentProfile", "PaymentProfileID") ??
      policyDefaults.paymentPolicyId,
  };

  return {
    title,
    description: getItemDescription(item),
    price: getProductPrice(item, variants),
    quantity,
    category: categoryId,
    categoryName: getString(item, "PrimaryCategory", "CategoryName") || null,
    condition: getCondition(item),
    images: getPictureUrls(item),
    itemSpecifics,
    status: ProductStatus.IMPORTED,
    ebayItemId: getString(item, "ItemID"),
    errorMessage: null,
    asin: extractAsin(item, itemSpecifics),
    amazonPrice: null,
    shippingPolicyId: policyIds.shippingPolicyId,
    returnPolicyId: policyIds.returnPolicyId,
    paymentPolicyId: policyIds.paymentPolicyId,
    policyTemplateId: policyIdsMatch(policyIds, policyDefaults)
      ? policyDefaults.policyTemplateId
      : null,
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

function getSellerListPagination(response: EbayNode, page: number) {
  const explicitTotalPages = toInteger(
    getPath(response, "PaginationResult", "TotalNumberOfPages"),
  );
  const hasMoreItems = /^true$/i.test(getString(response, "HasMoreItems"));
  const totalPages =
    explicitTotalPages !== null
      ? Math.max(1, explicitTotalPages)
      : hasMoreItems
        ? page + 1
        : page;

  return { totalPages, hasMoreItems };
}

async function fetchSellerListIdPage(
  storeNumber: 1 | 2 | 3,
  page: number,
): Promise<SellerListIdPage> {
  const xml = buildGetSellerListIdsXML(page);
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

  const pagination = getSellerListPagination(response, page);
  const itemIds = asArray(getPath(response, "ItemArray", "Item"))
    .filter(isNode)
    .filter(isImportableListing)
    .map((item) => getString(item, "ItemID"))
    .filter(Boolean);

  return { itemIds, ...pagination };
}

async function fetchSellerListDetailPage(
  storeNumber: 1 | 2 | 3,
  page: number,
): Promise<SellerListDetailPage> {
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

  const pagination = getSellerListPagination(response, page);
  const items = asArray(getPath(response, "ItemArray", "Item"))
    .filter(isNode)
    .filter(isImportableListing);

  return { items, ...pagination };
}

function isImportableListing(item: EbayNode) {
  const listingType = getString(item, "ListingType");
  return listingType === "FixedPriceItem" || listingType === "StoresFixedPrice";
}

async function fetchAllEbayListingIds(storeNumber: 1 | 2 | 3) {
  const itemIds: string[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await fetchSellerListIdPage(storeNumber, page);
    totalPages = response.totalPages;
    itemIds.push(...response.itemIds);

    if (page < totalPages) {
      await delay(250);
    }

    page += 1;
  } while (page <= totalPages);

  return uniqueStrings(itemIds);
}

async function getCachedEbayListingIds(
  storeId: string,
  storeNumber: 1 | 2 | 3,
  options: { forceRefresh?: boolean } = {},
) {
  const cached = await prisma.ebayImportStatsCache.findUnique({
    where: { storeId },
    select: {
      listingIds: true,
      fetchedAt: true,
    },
  });
  const now = Date.now();

  if (
    !options.forceRefresh &&
    cached &&
    now - cached.fetchedAt.getTime() < IMPORT_STATS_CACHE_TTL_MS
  ) {
    return {
      listingIds: cached.listingIds,
      fetchedAt: cached.fetchedAt,
    };
  }

  const listingIds = await fetchAllEbayListingIds(storeNumber);
  const fetchedAt = new Date(now);

  await prisma.ebayImportStatsCache.upsert({
    where: { storeId },
    create: {
      storeId,
      activeListings: listingIds.length,
      listingIds,
      fetchedAt,
    },
    update: {
      activeListings: listingIds.length,
      listingIds,
      fetchedAt,
    },
  });

  return { listingIds, fetchedAt };
}

export async function invalidateEbayImportStatsCache(storeId: string) {
  await prisma.ebayImportStatsCache.deleteMany({ where: { storeId } });
}

async function getExistingEbayItemIds(storeId: string, itemIds: string[]) {
  if (itemIds.length === 0) {
    return new Set<string>();
  }

  const products = await prisma.product.findMany({
    where: {
      storeId,
      ebayItemId: {
        in: itemIds,
      },
    },
    select: {
      ebayItemId: true,
    },
  });

  return new Set(
    products
      .map((product) => product.ebayItemId)
      .filter((itemId): itemId is string => Boolean(itemId)),
  );
}

export async function getEbayImportStats(
  options: Pick<EbayImportOptions, "storeId" | "storeNumber"> & {
    forceRefresh?: boolean;
  },
): Promise<EbayImportStats> {
  const { listingIds, fetchedAt } = await getCachedEbayListingIds(
    options.storeId,
    options.storeNumber,
    { forceRefresh: options.forceRefresh },
  );
  const existingIds = await getExistingEbayItemIds(options.storeId, listingIds);
  const remaining = listingIds.filter((itemId) => !existingIds.has(itemId));
  const staleInListFlow = await prisma.product.count({
    where: {
      storeId: options.storeId,
      ebayItemId: {
        not: null,
        notIn: listingIds,
      },
    },
  });

  return {
    activeListings: listingIds.length,
    alreadyImported: existingIds.size,
    remaining: remaining.length,
    staleInListFlow,
    fetchedAt: fetchedAt.toISOString(),
  };
}

export async function removeStaleListFlowEbayProducts(
  options: Pick<EbayImportOptions, "storeId" | "storeNumber">,
) {
  const { listingIds, fetchedAt } = await getCachedEbayListingIds(
    options.storeId,
    options.storeNumber,
    { forceRefresh: true },
  );
  const result = await prisma.product.deleteMany({
    where: {
      storeId: options.storeId,
      ebayItemId: {
        not: null,
        notIn: listingIds,
      },
    },
  });

  return {
    deleted: result.count,
    activeListings: listingIds.length,
    fetchedAt: fetchedAt.toISOString(),
  };
}

async function fetchEbayItemDetails(
  storeNumber: 1 | 2 | 3,
  itemId: string,
): Promise<EbayNode> {
  const xml = buildGetItemXML(itemId);
  const xmlText = await callEbayGetItem(xml, storeNumber);
  const parsed = parser.parse(xmlText) as EbayNode;
  const response = getPath(parsed, "GetItemResponse");

  if (!isNode(response)) {
    throw new Error("Invalid GetItem response from eBay");
  }

  const ack = getString(response, "Ack");

  if (ack !== "Success" && ack !== "Warning") {
    throw new Error(formatEbayErrors(getPath(response, "Errors")));
  }

  const item = getPath(response, "Item");

  if (!isNode(item)) {
    throw new Error("GetItem response did not include an item");
  }

  return item;
}

export async function refreshProductDescriptionFromEbay(
  storeId: string,
  storeNumber: 1 | 2 | 3,
  productId: string,
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true, ebayItemId: true },
  });

  if (!product?.ebayItemId) {
    throw new Error("Product does not have an eBay item ID.");
  }

  const item = await fetchEbayItemDetails(storeNumber, product.ebayItemId);
  const description = getItemDescription(item);

  if (!description) {
    throw new Error("eBay did not return a description for this listing.");
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { description },
  });

  return description;
}

async function fetchSelectedEbayItemDetails(
  storeNumber: 1 | 2 | 3,
  itemIds: string[],
) {
  const pendingIds = new Set(itemIds);
  const itemsById = new Map<string, EbayNode>();
  let page = 1;
  let totalPages = 1;

  while (pendingIds.size > 0 && page <= totalPages) {
    const response = await fetchSellerListDetailPage(storeNumber, page);
    totalPages = response.totalPages;

    for (const item of response.items) {
      const itemId = getString(item, "ItemID");

      if (!pendingIds.has(itemId)) {
        continue;
      }

      itemsById.set(itemId, item);
      pendingIds.delete(itemId);
    }

    if (pendingIds.size > 0 && page < totalPages) {
      await delay(250);
    }

    page += 1;
  }

  return itemsById;
}

function isRateLimitError(error: unknown) {
  return /rate|limit|quota|throttl/i.test(getErrorMessage(error));
}

async function importSingleItem(
  item: EbayNode,
  storeId: string,
  userId: string,
  policyDefaults: ResolvedPolicyDefaults,
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
      data: mapEbayItemToProduct(item, storeId, userId, policyDefaults),
    });

    return true;
  });
}

export async function importEbayListings(
  options: EbayImportOptions,
): Promise<EbayImportResult> {
  logger.info("ebay-import/importEbayListings", "Starting eBay listing import", {
    storeId: options.storeId,
    storeNumber: options.storeNumber,
    userId: options.userId,
    quantity: options.quantity,
  });

  const { listingIds } = await getCachedEbayListingIds(
    options.storeId,
    options.storeNumber,
    { forceRefresh: true },
  );
  const existingIds = await getExistingEbayItemIds(options.storeId, listingIds);
  const remainingIds = listingIds.filter((itemId) => !existingIds.has(itemId));
  const requested = Math.min(
    Math.max(0, Math.floor(options.quantity)),
    remainingIds.length,
  );
  const selectedIds = remainingIds.slice(0, requested);
  const policyDefaults = await getStorePolicyDefaults(options.storeId);
  const result: EbayImportResult = {
    requested,
    activeListings: listingIds.length,
    alreadyImported: existingIds.size,
    remainingBeforeImport: remainingIds.length,
    remainingAfterImport: remainingIds.length,
    created: 0,
    skipped: 0,
    failed: 0,
    rateLimited: false,
    errors: [],
  };

  await options.onProgress?.({
    processed: 0,
    total: selectedIds.length,
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
  });

  let itemsById = new Map<string, EbayNode>();

  try {
    itemsById = await fetchSelectedEbayItemDetails(
      options.storeNumber,
      selectedIds,
    );
  } catch (error) {
    logger.warn(
      "ebay-import/importEbayListings",
      "Batched GetSellerList detail fetch failed; falling back to per-item GetItem calls",
      {
        storeId: options.storeId,
        storeNumber: options.storeNumber,
        error: getErrorMessage(error),
      },
    );
  }

  for (const [index, itemId] of selectedIds.entries()) {
    let title = "(loading)";

    try {
      const batchedItem = itemsById.get(itemId);
      const item =
        batchedItem && getItemDescription(batchedItem)
          ? batchedItem
          : await fetchEbayItemDetails(options.storeNumber, itemId);
      title = getString(item, "Title") || "(no title)";

      if (!isImportableListing(item)) {
        result.skipped += 1;
      } else {
        const wasCreated = await importSingleItem(
          item,
          options.storeId,
          options.userId,
          policyDefaults,
        );

        if (wasCreated) {
          result.created += 1;
        } else {
          result.skipped += 1;
        }
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        itemId,
        title,
        error: getErrorMessage(error),
      });

      if (isRateLimitError(error)) {
        result.rateLimited = true;
      }
    }

    await options.onProgress?.({
      processed: index + 1,
      total: selectedIds.length,
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
      currentItemId: itemId,
    });

    if (result.rateLimited) {
      break;
    }
  }

  result.remainingAfterImport = Math.max(
    0,
    result.remainingBeforeImport - result.created - result.skipped,
  );

  logger.info("ebay-import/importEbayListings", "Finished eBay listing import", {
    storeId: options.storeId,
    storeNumber: options.storeNumber,
    ...result,
  });

  return result;
}

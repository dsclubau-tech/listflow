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
import {
  normalizeEbayImportSortDirection,
  normalizeEbayImportSkuList,
  selectEbayListingsForImport,
  type EbayImportSelectionMetadata,
  type EbayImportSortDirection,
  type EbayImportSortField,
  type EbayListingSummary,
} from "@/lib/ebay-import-selection";
import { resolveImportedListingAsin } from "@/lib/ebay-import-asin";
import { preserveEbayListingAsin } from "@/lib/ebay-listing-asin";
import { logger } from "@/lib/logger";
import { invalidateProductCaches } from "@/lib/cache-tags";
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
  skuList?: string[];
  sortField?: EbayImportSortField;
  sortDirection?: EbayImportSortDirection;
  selectionMetadata?: EbayImportSelectionMetadata;
  selectedListingIds?: string[];
  completedListingIds?: string[];
  initialCreated?: number;
  initialSkipped?: number;
  initialFailed?: number;
  initialErrors?: Array<{ itemId: string; title: string; error: string }>;
  previousRemainingBeforeImport?: number;
  onSelectionResolved?: (selection: ImportSelection) => void | Promise<void>;
  onProgress?: (progress: ImportProgress) => void | Promise<void>;
  shouldStop?: () => ImportStopReason | null | Promise<ImportStopReason | null>;
}

export interface ImportProgress {
  processed: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  currentItemId?: string;
  completedListingIds?: string[];
}

export interface ImportSelection {
  requested: number;
  activeListings: number;
  alreadyImported: number;
  remainingBeforeImport: number;
  selectedListingIds: string[];
  metadata: EbayImportSelectionMetadata;
}

export type ImportStopReason = "PAUSED" | "CANCELLED";

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
  processed: number;
  rateLimited: boolean;
  errors: Array<{ itemId: string; title: string; error: string }>;
  selectedListingIds: string[];
  completedListingIds: string[];
  metadata: EbayImportSelectionMetadata;
  stopReason: ImportStopReason | null;
}

type EbayNode = Record<string, unknown>;

interface SellerListIdPage {
  listings: EbayListingSummary[];
  totalPages: number;
  hasMoreItems: boolean;
}

interface SellerListDetailPage {
  items: EbayNode[];
  totalPages: number;
  hasMoreItems: boolean;
}

export interface EbayListingInventorySnapshot {
  itemId: string;
  title: string;
  quantityAvailable: number;
  quantitySold: number;
  quantityTotal: number | null;
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

function extractAsin(
  item: EbayNode,
  specifics: Record<string, string>,
  persistedAsin?: string | null,
): string | null {
  const variations = asArray(getPath(item, "Variations", "Variation")).filter(isNode);

  return resolveImportedListingAsin({
    listingSku: getString(item, "SKU"),
    variationSkus: variations.map((variation) => getString(variation, "SKU")),
    itemSpecifics: specifics,
    persistedAsin,
  });
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

function getListingSkus(item: EbayNode) {
  const skus = [getString(item, "SKU")];
  const variations = asArray(getPath(item, "Variations", "Variation")).filter(isNode);

  for (const variation of variations) {
    skus.push(getString(variation, "SKU"));
  }

  return uniqueStrings(skus);
}

function getListingStartTime(item: EbayNode) {
  return (
    getString(item, "ListingDetails", "StartTime") ||
    getString(item, "StartTime") ||
    null
  );
}

function mapListingSummary(item: EbayNode): EbayListingSummary | null {
  const itemId = getString(item, "ItemID");

  if (!itemId) {
    return null;
  }

  return {
    itemId,
    skus: getListingSkus(item),
    startTime: getListingStartTime(item),
  };
}

function getListingIdsFromSummaries(summaries: EbayListingSummary[]) {
  return uniqueStrings(summaries.map((summary) => summary.itemId));
}

function normalizeCachedListingSummaries(
  value: Prisma.JsonValue | null | undefined,
  fallbackListingIds: string[] = [],
) {
  if (!Array.isArray(value)) {
    return fallbackListingIds.map((itemId) => ({
      itemId,
      skus: [],
      startTime: null,
    }));
  }

  const summaries = value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const source = entry as Record<string, unknown>;
      const itemId = typeof source.itemId === "string" ? source.itemId.trim() : "";

      if (!itemId) {
        return null;
      }

      return {
        itemId,
        skus: normalizeEbayImportSkuList(source.skus),
        startTime: typeof source.startTime === "string" && source.startTime.trim()
          ? source.startTime.trim()
          : null,
      };
    })
    .filter((entry): entry is EbayListingSummary => Boolean(entry));

  return summaries.length > 0
    ? summaries
    : fallbackListingIds.map((itemId) => ({
        itemId,
        skus: [],
        startTime: null,
      }));
}

function toListingSummariesJson(summaries: EbayListingSummary[]) {
  return summaries.map((summary) => ({
    itemId: summary.itemId,
    skus: summary.skus,
    startTime: summary.startTime,
  })) as Prisma.InputJsonValue;
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

function getQuantitySold(source: unknown) {
  return toInteger(getPath(source, "SellingStatus", "QuantitySold")) ?? 0;
}

function getTotalQuantity(source: unknown) {
  const quantity = toInteger(getPath(source, "Quantity"));
  if (quantity !== null) {
    return Math.max(0, quantity);
  }

  const available = getAvailableQuantity(source);
  const sold = getQuantitySold(source);
  return available + sold;
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
  persistedAsin?: string | null,
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
    asin: extractAsin(item, itemSpecifics, persistedAsin),
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
  const listings = asArray(getPath(response, "ItemArray", "Item"))
    .filter(isNode)
    .filter(isImportableListing)
    .map(mapListingSummary)
    .filter((summary): summary is EbayListingSummary => Boolean(summary));

  return { listings, ...pagination };
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

export async function fetchActiveEbayListingInventory(
  storeNumber: 1 | 2 | 3,
): Promise<EbayListingInventorySnapshot[]> {
  const listings = new Map<string, EbayListingInventorySnapshot>();
  let page = 1;
  let totalPages = 1;

  do {
    const response = await fetchSellerListDetailPage(storeNumber, page);
    totalPages = response.totalPages;

    for (const item of response.items) {
      const itemId = getString(item, "ItemID");
      if (!itemId || listings.has(itemId)) {
        continue;
      }

      listings.set(itemId, {
        itemId,
        title: getString(item, "Title") || "(no title)",
        quantityAvailable: getAvailableQuantity(item),
        quantitySold: getQuantitySold(item),
        quantityTotal: getTotalQuantity(item),
      });
    }

    if (page < totalPages) {
      await delay(250);
    }

    page += 1;
  } while (page <= totalPages);

  return Array.from(listings.values());
}

function isImportableListing(item: EbayNode) {
  const listingType = getString(item, "ListingType");
  return listingType === "FixedPriceItem" || listingType === "StoresFixedPrice";
}

async function fetchAllEbayListingSummaries(storeNumber: 1 | 2 | 3) {
  const listingsById = new Map<string, EbayListingSummary>();
  let page = 1;
  let totalPages = 1;

  do {
    const response = await fetchSellerListIdPage(storeNumber, page);
    totalPages = response.totalPages;

    for (const listing of response.listings) {
      if (!listingsById.has(listing.itemId)) {
        listingsById.set(listing.itemId, listing);
      }
    }

    if (page < totalPages) {
      await delay(250);
    }

    page += 1;
  } while (page <= totalPages);

  return Array.from(listingsById.values());
}

async function getCachedEbayListingSummaries(
  storeId: string,
  storeNumber: 1 | 2 | 3,
  options: { forceRefresh?: boolean } = {},
) {
  const cached = await prisma.ebayImportStatsCache.findUnique({
    where: { storeId },
    select: {
      listingIds: true,
      listingSummaries: true,
      fetchedAt: true,
    },
  });
  const now = Date.now();
  const cachedSummaryArray = Array.isArray(cached?.listingSummaries)
    ? cached.listingSummaries
    : [];
  const cachedSummaries = cached
    ? normalizeCachedListingSummaries(cached.listingSummaries, cached.listingIds)
    : [];
  const cacheHasSummaryDetails =
    cachedSummaryArray.length > 0 || (cached?.listingIds.length ?? 0) === 0;

  if (
    !options.forceRefresh &&
    cached &&
    cacheHasSummaryDetails &&
    now - cached.fetchedAt.getTime() < IMPORT_STATS_CACHE_TTL_MS
  ) {
    return {
      listingSummaries: cachedSummaries,
      listingIds: getListingIdsFromSummaries(cachedSummaries),
      fetchedAt: cached.fetchedAt,
    };
  }

  const listingSummaries = await fetchAllEbayListingSummaries(storeNumber);
  const listingIds = getListingIdsFromSummaries(listingSummaries);
  const fetchedAt = new Date(now);

  await prisma.ebayImportStatsCache.upsert({
    where: { storeId },
    create: {
      storeId,
      activeListings: listingIds.length,
      listingIds,
      listingSummaries: toListingSummariesJson(listingSummaries),
      fetchedAt,
    },
    update: {
      activeListings: listingIds.length,
      listingIds,
      listingSummaries: toListingSummariesJson(listingSummaries),
      fetchedAt,
    },
  });

  return { listingSummaries, listingIds, fetchedAt };
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

export async function resolveEbayImportSelection(
  options: Pick<
    EbayImportOptions,
    "storeId" | "storeNumber" | "quantity" | "skuList" | "sortField" | "sortDirection"
  > & {
    forceRefresh?: boolean;
  },
): Promise<ImportSelection> {
  const { listingSummaries, listingIds } = await getCachedEbayListingSummaries(
    options.storeId,
    options.storeNumber,
    { forceRefresh: options.forceRefresh },
  );
  const existingIds = await getExistingEbayItemIds(options.storeId, listingIds);

  return selectEbayListingsForImport({
    listingSummaries,
    existingListingIds: existingIds,
    quantity: options.quantity,
    skuList: options.skuList,
    sortField: options.sortField,
    sortDirection: options.sortDirection,
  });
}

export async function getEbayImportStats(
  options: Pick<EbayImportOptions, "storeId" | "storeNumber"> & {
    forceRefresh?: boolean;
  },
): Promise<EbayImportStats> {
  const { listingIds, fetchedAt } = await getCachedEbayListingSummaries(
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
  const { listingIds, fetchedAt } = await getCachedEbayListingSummaries(
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

  if (result.count > 0) {
    invalidateProductCaches(options.storeId);
  }

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

  invalidateProductCaches(storeId);

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
  persistedAsin?: string | null,
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

    const productData = mapEbayItemToProduct(
      item,
      storeId,
      userId,
      policyDefaults,
      persistedAsin,
    );

    await tx.product.create({
      data: productData,
    });

    await preserveEbayListingAsin(tx, {
      storeId,
      ebayItemId: itemId,
      asin: typeof productData.asin === "string" ? productData.asin : null,
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

  const suppliedSelectedIds = uniqueStrings(
    options.selectedListingIds?.filter(Boolean) ?? [],
  );
  const { listingSummaries, listingIds } = await getCachedEbayListingSummaries(
    options.storeId,
    options.storeNumber,
    { forceRefresh: suppliedSelectedIds.length === 0 },
  );
  const existingIds = await getExistingEbayItemIds(options.storeId, listingIds);
  const remainingIds = listingIds.filter((itemId) => !existingIds.has(itemId));
  const computedSelection = selectEbayListingsForImport({
    listingSummaries,
    existingListingIds: existingIds,
    quantity: options.quantity,
    skuList: options.skuList,
    sortField: options.sortField,
    sortDirection: options.sortDirection,
  });
  const selectedIds = suppliedSelectedIds.length > 0
    ? suppliedSelectedIds
    : computedSelection.selectedListingIds;
  const defaultMetadata: EbayImportSelectionMetadata = {
    mode: normalizeEbayImportSkuList(options.skuList).length > 0
      ? "SKU"
      : "QUANTITY",
    skuList: normalizeEbayImportSkuList(options.skuList),
    unmatchedSkus: [],
    matchedSkuCount: 0,
    selectedListingCount: selectedIds.length,
    sortField: "START_DATE" as const,
    sortDirection: normalizeEbayImportSortDirection(options.sortDirection),
  };
  const selection = suppliedSelectedIds.length > 0
    ? {
        requested: selectedIds.length,
        activeListings: listingIds.length,
        alreadyImported: existingIds.size,
        remainingBeforeImport: remainingIds.length,
        selectedListingIds: selectedIds,
        metadata: options.selectionMetadata ?? defaultMetadata,
      }
    : computedSelection;
  const selectedIdSet = new Set(selectedIds);
  const completedIds = new Set(
    (options.completedListingIds ?? []).filter((itemId) =>
      selectedIdSet.has(itemId),
    ),
  );
  const requested = selection.requested;
  const policyDefaults = await getStorePolicyDefaults(options.storeId);
  const persistedListingAsins = await prisma.ebayListingAsin.findMany({
    where: {
      storeId: options.storeId,
      ebayItemId: { in: selectedIds },
    },
    select: { ebayItemId: true, asin: true },
  });
  const persistedAsinByItemId = new Map(
    persistedListingAsins.map((entry) => [entry.ebayItemId, entry.asin]),
  );
  const remainingBeforeImport =
    options.previousRemainingBeforeImport && options.previousRemainingBeforeImport > 0
      ? options.previousRemainingBeforeImport
      : selection.remainingBeforeImport;
  const result: EbayImportResult = {
    requested,
    activeListings: selection.activeListings,
    alreadyImported: selection.alreadyImported,
    remainingBeforeImport,
    remainingAfterImport: remainingBeforeImport,
    created: options.initialCreated ?? 0,
    skipped: options.initialSkipped ?? 0,
    failed: options.initialFailed ?? 0,
    processed: completedIds.size,
    rateLimited: false,
    errors: options.initialErrors ?? [],
    selectedListingIds: selectedIds,
    completedListingIds: [...completedIds],
    metadata: selection.metadata,
    stopReason: null,
  };

  await options.onSelectionResolved?.({
    requested,
    activeListings: result.activeListings,
    alreadyImported: result.alreadyImported,
    remainingBeforeImport: result.remainingBeforeImport,
    selectedListingIds: selectedIds,
    metadata: result.metadata,
  });

  await options.onProgress?.({
    processed: completedIds.size,
    total: selectedIds.length,
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
    completedListingIds: [...completedIds],
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

  for (const itemId of selectedIds) {
    if (completedIds.has(itemId)) {
      continue;
    }

    const stopReason = await options.shouldStop?.();

    if (stopReason) {
      result.stopReason = stopReason;
      break;
    }

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
          persistedAsinByItemId.get(itemId),
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

    completedIds.add(itemId);
    result.processed = completedIds.size;
    result.completedListingIds = [...completedIds];

    await options.onProgress?.({
      processed: result.processed,
      total: selectedIds.length,
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
      currentItemId: itemId,
      completedListingIds: result.completedListingIds,
    });

    if (result.rateLimited) {
      break;
    }

    const postItemStopReason = await options.shouldStop?.();

    if (postItemStopReason) {
      result.stopReason = postItemStopReason;
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

  if (result.created > 0) {
    invalidateProductCaches(options.storeId);
  }

  return result;
}

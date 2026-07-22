export type EbayImportSortField = "START_DATE";
export type EbayImportSortDirection = "ASC" | "DESC";
export type EbayImportSelectionMode = "QUANTITY" | "SKU";

export interface EbayListingSummary {
  itemId: string;
  skus: string[];
  startTime: string | null;
}

export interface EbayImportSelectionMetadata {
  mode: EbayImportSelectionMode;
  skuList: string[];
  unmatchedSkus: string[];
  matchedSkuCount: number;
  selectedListingCount: number;
  sortField: EbayImportSortField;
  sortDirection: EbayImportSortDirection;
}

export interface EbayImportSelectionResult {
  requested: number;
  activeListings: number;
  alreadyImported: number;
  remainingBeforeImport: number;
  selectedListingIds: string[];
  metadata: EbayImportSelectionMetadata;
}

export class EbayImportSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayImportSelectionError";
  }
}

function splitSkuText(value: string) {
  return value.split(/[\r\n,;\t]+/);
}

export function normalizeEbayImportSkuList(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value.flatMap((entry) => splitSkuText(String(entry ?? "")))
    : typeof value === "string"
      ? splitSkuText(value)
      : [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawValue of rawValues) {
    const sku = rawValue.trim();
    const key = sku.toLocaleLowerCase();

    if (!sku || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(sku);
  }

  return normalized;
}

export function normalizeEbayImportSortField(value: unknown): EbayImportSortField {
  return value === "START_DATE" ? "START_DATE" : "START_DATE";
}

export function normalizeEbayImportSortDirection(
  value: unknown,
): EbayImportSortDirection {
  return String(value ?? "").toUpperCase() === "ASC" ? "ASC" : "DESC";
}

export function buildQueuedEbayImportRequest(input: {
  quantity: number;
  skuList?: unknown;
  sortField?: unknown;
  sortDirection?: unknown;
}) {
  const quantity = Math.max(1, Math.floor(input.quantity));
  const skuList = normalizeEbayImportSkuList(input.skuList);
  const requested = skuList.length > 0 ? skuList.length : quantity;
  const metadata: EbayImportSelectionMetadata = {
    mode: skuList.length > 0 ? "SKU" : "QUANTITY",
    skuList,
    unmatchedSkus: [],
    matchedSkuCount: 0,
    selectedListingCount: 0,
    sortField: normalizeEbayImportSortField(input.sortField),
    sortDirection: normalizeEbayImportSortDirection(input.sortDirection),
  };

  return { quantity, requested, total: requested, metadata };
}

function parseStartTime(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortEbayListingSummariesForImport(
  summaries: EbayListingSummary[],
  direction: EbayImportSortDirection = "DESC",
) {
  return [...summaries].sort((left, right) => {
    const leftStart = parseStartTime(left.startTime);
    const rightStart = parseStartTime(right.startTime);

    if (leftStart === null && rightStart === null) {
      return left.itemId.localeCompare(right.itemId);
    }

    if (leftStart === null) {
      return 1;
    }

    if (rightStart === null) {
      return -1;
    }

    const dateDiff = direction === "ASC" ? leftStart - rightStart : rightStart - leftStart;
    return dateDiff || left.itemId.localeCompare(right.itemId);
  });
}

function normalizeSummarySkus(summary: EbayListingSummary) {
  return new Set(
    summary.skus
      .map((sku) => sku.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
}

function uniqueListingSummaries(summaries: EbayListingSummary[]) {
  const seen = new Set<string>();
  const uniqueSummaries: EbayListingSummary[] = [];

  for (const summary of summaries) {
    const itemId = summary.itemId.trim();

    if (!itemId || seen.has(itemId)) {
      continue;
    }

    seen.add(itemId);
    uniqueSummaries.push({
      itemId,
      skus: normalizeEbayImportSkuList(summary.skus),
      startTime: summary.startTime || null,
    });
  }

  return uniqueSummaries;
}

export function selectEbayListingsForImport(input: {
  listingSummaries: EbayListingSummary[];
  existingListingIds?: Iterable<string>;
  quantity?: number;
  skuList?: unknown;
  sortField?: unknown;
  sortDirection?: unknown;
}): EbayImportSelectionResult {
  const sortField = normalizeEbayImportSortField(input.sortField);
  const sortDirection = normalizeEbayImportSortDirection(input.sortDirection);
  const skuList = normalizeEbayImportSkuList(input.skuList);
  const mode: EbayImportSelectionMode = skuList.length > 0 ? "SKU" : "QUANTITY";
  const existingIds = new Set(input.existingListingIds ?? []);
  const activeSummaries = uniqueListingSummaries(input.listingSummaries);
  const remainingSummaries = sortEbayListingSummariesForImport(
    activeSummaries.filter((summary) => !existingIds.has(summary.itemId)),
    sortDirection,
  );

  let selectedSummaries: EbayListingSummary[];
  let unmatchedSkus: string[] = [];
  let matchedSkuCount = 0;

  if (mode === "SKU") {
    const requestedSkuKeys = new Set(skuList.map((sku) => sku.toLocaleLowerCase()));
    const matchedKeys = new Set<string>();

    selectedSummaries = remainingSummaries.filter((summary) => {
      const summarySkuKeys = normalizeSummarySkus(summary);
      let hasMatch = false;

      for (const skuKey of requestedSkuKeys) {
        if (summarySkuKeys.has(skuKey)) {
          hasMatch = true;
          matchedKeys.add(skuKey);
        }
      }

      return hasMatch;
    });

    matchedSkuCount = matchedKeys.size;
    unmatchedSkus = skuList.filter((sku) => !matchedKeys.has(sku.toLocaleLowerCase()));
  } else {
    const quantity = Math.min(
      Math.max(0, Math.floor(Number(input.quantity) || 0)),
      remainingSummaries.length,
    );
    selectedSummaries = remainingSummaries.slice(0, quantity);
  }

  return {
    requested: selectedSummaries.length,
    activeListings: activeSummaries.length,
    alreadyImported: activeSummaries.length - remainingSummaries.length,
    remainingBeforeImport: remainingSummaries.length,
    selectedListingIds: selectedSummaries.map((summary) => summary.itemId),
    metadata: {
      mode,
      skuList,
      unmatchedSkus,
      matchedSkuCount,
      selectedListingCount: selectedSummaries.length,
      sortField,
      sortDirection,
    },
  };
}

import { isValidAsin, normalizeAsin } from "@/lib/price-check-eligibility";

export const MAX_BULK_ASIN_MAPPINGS = 500;

export type BulkAsinMapping = {
  identifier: string;
  asin: string;
};

export type BulkAsinMappingIssue = {
  identifier: string;
  asin?: string;
  reason: string;
};

export type BulkAsinCandidate = {
  id: string;
  ebayItemId: string | null;
  variants: Array<{ sku: string | null }>;
};

export type BulkAsinUpdate = BulkAsinMapping & {
  productId: string;
};

function normalizeIdentifier(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function identifierKey(value: string) {
  return value.toLocaleLowerCase("en-AU");
}

export function parseBulkAsinMappingText(value: string) {
  const mappings: BulkAsinMapping[] = [];
  const invalid: Array<BulkAsinMappingIssue & { line: number }> = [];

  value.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (!line) {
      return;
    }

    const tabIndex = line.indexOf("\t");
    const commaIndex = line.indexOf(",");
    const separatorIndex =
      tabIndex >= 0 && commaIndex >= 0
        ? Math.min(tabIndex, commaIndex)
        : Math.max(tabIndex, commaIndex);

    if (separatorIndex < 0) {
      invalid.push({
        line: index + 1,
        identifier: line,
        reason: "Use eBay item ID or SKU, followed by an ASIN.",
      });
      return;
    }

    mappings.push({
      identifier: line.slice(0, separatorIndex).trim(),
      asin: line.slice(separatorIndex + 1).trim(),
    });
  });

  return { mappings, invalid };
}

export function validateBulkAsinMappings(input: unknown) {
  const invalid: BulkAsinMappingIssue[] = [];

  if (!Array.isArray(input)) {
    return {
      mappings: [] as BulkAsinMapping[],
      invalid: [
        {
          identifier: "",
          reason: "mappings must be an array.",
        },
      ],
    };
  }

  const byIdentifier = new Map<string, BulkAsinMapping>();
  const conflictingIdentifiers = new Set<string>();

  for (const value of input) {
    const identifier =
      value && typeof value === "object" && "identifier" in value
        ? normalizeIdentifier((value as { identifier?: unknown }).identifier)
        : "";
    const asinValue =
      value && typeof value === "object" && "asin" in value
        ? (value as { asin?: unknown }).asin
        : undefined;
    const asin = normalizeAsin(asinValue);

    if (!identifier) {
      invalid.push({ identifier, asin: asin ?? undefined, reason: "Identifier is required." });
      continue;
    }

    if (!asin || !isValidAsin(asin)) {
      invalid.push({
        identifier,
        asin: asin ?? undefined,
        reason: "ASIN must be exactly 10 letters or numbers.",
      });
      continue;
    }

    const key = identifierKey(identifier);
    const existing = byIdentifier.get(key);

    if (existing && existing.asin !== asin) {
      conflictingIdentifiers.add(key);
      continue;
    }

    byIdentifier.set(key, { identifier, asin });
  }

  for (const key of conflictingIdentifiers) {
    const mapping = byIdentifier.get(key);
    byIdentifier.delete(key);
    invalid.push({
      identifier: mapping?.identifier ?? key,
      reason: "Identifier was assigned more than one ASIN.",
    });
  }

  return { mappings: [...byIdentifier.values()], invalid };
}

export function resolveBulkAsinMappings(
  candidates: BulkAsinCandidate[],
  mappings: BulkAsinMapping[],
) {
  const ebayItemIds = new Map<string, Set<string>>();
  const skuIds = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    const ebayItemId = normalizeIdentifier(candidate.ebayItemId);

    if (ebayItemId) {
      const key = identifierKey(ebayItemId);
      const ids = ebayItemIds.get(key) ?? new Set<string>();
      ids.add(candidate.id);
      ebayItemIds.set(key, ids);
    }

    for (const variant of candidate.variants) {
      const sku = normalizeIdentifier(variant.sku);

      if (!sku) {
        continue;
      }

      const key = identifierKey(sku);
      const ids = skuIds.get(key) ?? new Set<string>();
      ids.add(candidate.id);
      skuIds.set(key, ids);
    }
  }

  const unmatched: string[] = [];
  const ambiguous = new Set<string>();
  const tentative: BulkAsinUpdate[] = [];

  for (const mapping of mappings) {
    const key = identifierKey(mapping.identifier);
    const itemMatches = ebayItemIds.get(key);
    const matches = itemMatches && itemMatches.size > 0 ? itemMatches : skuIds.get(key);

    if (!matches || matches.size === 0) {
      unmatched.push(mapping.identifier);
      continue;
    }

    if (matches.size !== 1) {
      ambiguous.add(mapping.identifier);
      continue;
    }

    tentative.push({
      ...mapping,
      productId: [...matches][0],
    });
  }

  const byProduct = new Map<string, BulkAsinUpdate[]>();

  for (const update of tentative) {
    const productUpdates = byProduct.get(update.productId) ?? [];
    productUpdates.push(update);
    byProduct.set(update.productId, productUpdates);
  }

  const updates: BulkAsinUpdate[] = [];

  for (const productUpdates of byProduct.values()) {
    const asins = new Set(productUpdates.map((update) => update.asin));

    if (asins.size > 1) {
      productUpdates.forEach((update) => ambiguous.add(update.identifier));
      continue;
    }

    updates.push(productUpdates[0]);
  }

  return {
    updates,
    unmatched,
    ambiguous: [...ambiguous],
  };
}

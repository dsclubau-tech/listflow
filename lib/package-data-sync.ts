import "server-only";

import { XMLParser } from "fast-xml-parser";
import {
  applyPackageDimensionItemSpecifics,
  type PackageDimensions,
} from "@/lib/amazon-package-dimensions";
import { callEbayGetItem } from "@/lib/ebay";
import { extractEbayPackageDimensions } from "@/lib/ebay-package-details";
import { buildGetItemXML } from "@/lib/ebay-xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  trimValues: true,
  processEntities: {
    maxTotalExpansions: 20_000,
    maxExpandedLength: 5_000_000,
  },
});

type EbayNode = Record<string, unknown>;

export type PackageVerificationStatus = "confirmed" | "missing" | "mismatch" | "not-sent";

export type PackageVerification = {
  status: PackageVerificationStatus;
  expected: PackageDimensions | null;
  actual: PackageDimensions | null;
};

function isNode(value: unknown): value is EbayNode {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function readText(node: EbayNode, name: string) {
  const value = firstValue(node[name]);
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function formatEbayErrors(source: unknown) {
  const errors = Array.isArray(source) ? source : source ? [source] : [];
  const messages = errors
    .filter(isNode)
    .map((error) => readText(error, "LongMessage") || readText(error, "ShortMessage"))
    .filter(Boolean);

  return messages.join("; ") || "eBay did not return item package details.";
}

function toItemSpecificRecord(value: unknown): Record<string, string> {
  if (!isNode(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (typeof entry === "string" || typeof entry === "number") {
        return [[key, String(entry)]];
      }

      return [];
    }),
  );
}

function round(value: number, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function parseStoredNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseStoredPositiveNumber(value: string | undefined) {
  const parsed = parseStoredNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function getStoredPackageDimensions(
  itemSpecifics: Record<string, string>,
): PackageDimensions | null {
  const weightKg = parseStoredNumber(itemSpecifics._WeightKg);
  const weightG = parseStoredNumber(itemSpecifics._WeightG);
  const lengthCm = parseStoredPositiveNumber(itemSpecifics._LengthCm);
  const widthCm = parseStoredPositiveNumber(itemSpecifics._WidthCm);
  const heightCm = parseStoredPositiveNumber(itemSpecifics._HeightCm);
  const hasWeight = (weightKg ?? 0) > 0 || (weightG ?? 0) > 0;
  const hasDimensions = Boolean(lengthCm && widthCm && heightCm);

  if (!hasWeight && !hasDimensions) {
    return null;
  }

  const result: PackageDimensions = { convertedUnits: [] };

  if (hasWeight) {
    result.weightKg = weightKg ?? 0;
    result.weightG = weightG ?? 0;
  }

  if (
    hasDimensions &&
    lengthCm !== null &&
    widthCm !== null &&
    heightCm !== null
  ) {
    result.lengthCm = lengthCm;
    result.widthCm = widthCm;
    result.heightCm = heightCm;
  }

  return result;
}

export function canonicalizePackageItemSpecifics(itemSpecifics: unknown) {
  return applyPackageDimensionItemSpecifics(toItemSpecificRecord(itemSpecifics));
}

function isSameNumber(left: number | undefined, right: number | undefined) {
  if (left === undefined) {
    return true;
  }

  return right !== undefined && Math.abs(left - right) < 0.01;
}

function buildExpectedEbayPackageDimensions(
  dimensions: PackageDimensions | null,
): PackageDimensions | null {
  if (!dimensions) {
    return null;
  }

  return {
    ...(dimensions.weightKg !== undefined || dimensions.weightG !== undefined
      ? { weightKg: dimensions.weightKg ?? 0, weightG: dimensions.weightG ?? 0 }
      : {}),
    ...(dimensions.lengthCm !== undefined &&
    dimensions.widthCm !== undefined &&
    dimensions.heightCm !== undefined
      ? {
          lengthCm: Math.ceil(dimensions.lengthCm),
          widthCm: Math.ceil(dimensions.widthCm),
          heightCm: Math.ceil(dimensions.heightCm),
        }
      : {}),
    convertedUnits: [],
  };
}

export function compareEbayPackageDimensions(input: {
  itemSpecifics: Record<string, string>;
  ebayItem: unknown;
}): PackageVerification {
  const expected = buildExpectedEbayPackageDimensions(
    getStoredPackageDimensions(input.itemSpecifics),
  );
  const actual = extractEbayPackageDimensions(input.ebayItem);

  if (!expected) {
    return { status: "not-sent", expected, actual };
  }

  if (!actual) {
    return { status: "missing", expected, actual };
  }

  const matches =
    isSameNumber(expected.weightKg, actual.weightKg) &&
    isSameNumber(expected.weightG, actual.weightG) &&
    isSameNumber(expected.lengthCm, actual.lengthCm) &&
    isSameNumber(expected.widthCm, actual.widthCm) &&
    isSameNumber(expected.heightCm, actual.heightCm);

  return { status: matches ? "confirmed" : "mismatch", expected, actual };
}

export async function fetchEbayPackageItem(input: {
  ebayItemId: string;
  storeNumber: 1 | 2 | 3;
}) {
  const xmlText = await callEbayGetItem(
    buildGetItemXML(input.ebayItemId),
    input.storeNumber,
  );
  const parsed = parser.parse(xmlText) as EbayNode;
  const response = firstValue(parsed.GetItemResponse);

  if (!isNode(response)) {
    throw new Error("Invalid GetItem response from eBay.");
  }

  const ack = readText(response, "Ack");
  if (ack !== "Success" && ack !== "Warning") {
    throw new Error(formatEbayErrors(response.Errors));
  }

  const item = firstValue(response.Item);
  if (!isNode(item)) {
    throw new Error("eBay did not return the listing details.");
  }

  return item;
}

export function mergeEbayPackageItemSpecifics(input: {
  itemSpecifics: unknown;
  ebayItem: unknown;
}) {
  const local = canonicalizePackageItemSpecifics(input.itemSpecifics);
  const ebayDimensions = extractEbayPackageDimensions(input.ebayItem);

  if (!ebayDimensions) {
    return local;
  }

  const next = { ...local };
  const existing = getStoredPackageDimensions(next);

  if (!existing?.weightKg && !existing?.weightG) {
    if (ebayDimensions.weightKg !== undefined) next._WeightKg = String(ebayDimensions.weightKg);
    if (ebayDimensions.weightG !== undefined) next._WeightG = String(ebayDimensions.weightG);
  }

  if (!existing?.lengthCm && ebayDimensions.lengthCm !== undefined) {
    next._LengthCm = String(round(ebayDimensions.lengthCm));
    next._WidthCm = String(round(ebayDimensions.widthCm ?? 0));
    next._HeightCm = String(round(ebayDimensions.heightCm ?? 0));
  }

  return next;
}
